import { clean, validateMember, parseSnapshot, snapshotDate } from './snapshot-format.js';


const SAMPLE_MEMBERS = [
  { first: 'Ada', last: 'Example', class: '2002', email: 'ada@example.invalid', city: 'Sampletown', state: 'CA', currentDues: 'PAID' },
  { first: 'Bea', last: 'Sample', class: '2015', email: 'bea@example.invalid', city: 'Example City', state: 'MA', currentDues: 'PLEASE JOIN' },
  { first: 'Cora', last: 'Demonstration', class: '1998', email: 'cora@example.invalid', currentDues: 'DUES PENDING' }
];

const $ = id => document.getElementById(id);
const entryForm = $('entryForm');
let database;
let members = [];
let signins = [];
let selectedMember = null;
let editingSignin = null;
let guestMode = false;
let snapshotSource = null;
let pendingImport = null;
const currentEvent = () => clean($('eventName').value);
const eventSignins = () => signins.filter(row => row.EventName === currentEvent());

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ebsc-signin-prototype', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('settings');
      db.createObjectStore('signins', { keyPath: 'id', autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function operation(store, mode, action) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(store, mode);
    const request = action(tx.objectStore(store));
    let result;
    request.onsuccess = () => { result = request.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const getSetting = key => operation('settings', 'readonly', store => store.get(key));
const putSetting = (key, value) => operation('settings', 'readwrite', store => store.put(value, key));
const putSnapshot = value => operation('settings', 'readwrite', store => {
  const request = store.put(value, 'snapshot');
  store.delete('members');
  return request;
});
const getSignins = () => operation('signins', 'readonly', store => store.getAll());
const saveSignin = row => operation('signins', 'readwrite', store => store.put(row));

function message(text) {
  $('message').textContent = text;
  $('message').hidden = !text;
}
function showView(view) {
  $('searchView').hidden = view !== 'search';
  $('entryView').hidden = view !== 'entry';
  $('organizerView').hidden = view !== 'organizer';
  $('attendeeBar').hidden = view !== 'search';
  $('organizerButton').hidden = view === 'organizer';
  window.scrollTo({ top: 0, behavior: 'auto' });
}
function updateEventTitle() {
  $('eventTitle').textContent = `${currentEvent() || 'Event'} Sign In`;
}
function money(value) { return Number(value || 0).toFixed(2); }
function localTimestamp(date) {
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function replaceMembers(values, source) {
  const checked = values.map(validateMember);
  await putSnapshot({ members: checked, source });
  members = checked;
  snapshotSource = source;
  renderMembers();
  message(`${members.length} members stored on this device.`);
}

function matchedRecordKey(member) {
  return [member.first, member.last, member.class, member.email].map(clean).join('\u0000');
}

function submissionMatchKey(row) {
  return [row.MatchedFirst, row.MatchedLast, row.MatchedClass, row.MatchedEmail].map(clean).join('\u0000');
}

function latestSubmissionFor(member) {
  const key = matchedRecordKey(member);
  return [...eventSignins()].reverse().find(row => submissionMatchKey(row) === key);
}

function memberFromSubmission(row) {
  return {
    first: row.First, last: row.Last, class: row.Class, email: row['Email Address'],
    address1: row.Address1, address2: row.Address2, city: row.City, state: row.State,
    zip: row.Zip, mobile: row.Mobile, altPhone: row['Alt Phone']
  };
}

function renderMembers() {
  const sourceText = snapshotSource?.exportedAt
    ? ` Snapshot exported ${snapshotDate(snapshotSource.exportedAt).toLocaleString()}.`
    : snapshotSource?.type === 'sample' ? ' Fabricated sample data.' : '';
  $('memberCount').textContent = `${members.length} members stored on this device.${sourceText}`;
  const term = $('search').value.trim().toLocaleLowerCase();
  const results = $('results');
  results.replaceChildren();
  if (!term) {
    results.textContent = 'Type a last name or email to find your record.';
    return;
  }
  const snapshotCandidates = members.map(original => {
    const saved = latestSubmissionFor(original);
    return { original, saved, current: saved ? memberFromSubmission(saved) : original, guest: false };
  });
  const localCandidates = eventSignins()
    .filter(row => !row.MatchedFirst && !row.MatchedLast && !row.MatchedClass && !row.MatchedEmail)
    .map(saved => ({ original: null, saved, current: memberFromSubmission(saved),
      guest: saved.RecordStatus === 'NEW BY REQUEST' || saved.RecordStatus === 'SIGNIN ONLY (NOT EBSC)' }));
  const matches = [...snapshotCandidates, ...localCandidates]
    .filter(({ current, original }) =>
      `${current.first} ${current.last} ${current.email} ${original?.first ?? ''} ${original?.last ?? ''} ${original?.email ?? ''}`
        .toLocaleLowerCase().includes(term))
    .slice(0, 30);
  for (const candidate of matches) {
    const { current, original, saved, guest } = candidate;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'result';
    const name = document.createElement('strong');
    name.textContent = `${current.first} ${current.last}`;
    const context = document.createElement('small');
    context.textContent = `${current.class} · ${current.email}`;
    button.append(name, context);
    button.addEventListener('click', () => startEntry(original, guest, saved));
    results.append(button);
  }
  if (!matches.length) results.textContent = 'No matching members. You can sign in someone new.';
}

function startEntry(member, guest = false, savedRow = null) {
  message('');
  selectedMember = member;
  editingSignin = savedRow;
  guestMode = guest;
  $('guestToggle').checked = guest;
  entryForm.reset();
  const current = savedRow ? memberFromSubmission(savedRow) : member;
  for (const field of ['first', 'last', 'class', 'email', 'mobile', 'altPhone', 'address1', 'address2', 'city', 'state', 'zip']) {
    entryForm.elements.namedItem(field).value = current?.[field] ?? '';
  }
  if (savedRow) {
    for (const [field, value] of Object.entries({
      membership: savedRow.Membership, dues: savedRow.DuesAmount,
      donation: savedRow.DonationAmount, method: savedRow.HowToPay,
      received: savedRow.AmountPaid === 'None' ? '' : savedRow.AmountPaid
    })) entryForm.elements.namedItem(field).value = value ?? '';
    entryForm.elements.namedItem('addByRequest').checked = savedRow.RecordStatus === 'NEW BY REQUEST';
  }
  $('entryTitle').textContent = guest ? 'Guest sign-in' :
    current && (savedRow || member) ? `Sign in ${current.first} ${current.last}` : 'New record';
  $('currentDues').textContent = member?.currentDues || (member ? 'Unknown' : 'New record');
  $('membershipPanel').hidden = guest;
  $('guestOptIn').hidden = !guest;
  showView('entry');
}
function formValue(name) { return clean(entryForm.elements.namedItem(name).value); }

function makeSignin() {
  const membership = guestMode ? 'None' : formValue('membership');
  const dues = guestMode ? 0 : Number(formValue('dues') || 0);
  const donationText = guestMode ? '0' : formValue('donation');
  if (!/^\d+(?:\.\d{1,2})?$/.test(donationText))
    throw Error('Enter a donation amount with no more than two decimal places.');
  const donation = Number(donationText);
  const method = guestMode ? 'None' : formValue('method');
  const received = guestMode ? '' : formValue('received');
  const memberClass = formValue('class');
  const state = formValue('state').toUpperCase();
  const zip = formValue('zip');
  const mobile = formValue('mobile');
  const altPhone = formValue('altPhone');
  if (!/^\d{4}(?: [A-Za-z]+)?$/.test(memberClass))
    throw Error('Class must start with four digits, optionally followed by a space and letters.');
  if (state && !/^[A-Z]{2}$/.test(state)) throw Error('State must be two letters.');
  if (zip && !/^[0-9-]+$/.test(zip)) throw Error('ZIP may contain only digits and hyphens.');
  if ([mobile, altPhone].some(phone => !/^[+()0-9 -]*$/.test(phone)))
    throw Error('Phone numbers may contain only digits, spaces, +, parentheses, and hyphens.');
  if (membership === 'None' && dues > 0) throw Error('Choose a membership for a dues amount.');
  if (membership !== 'None' && dues <= 0) throw Error('Enter a dues amount for the membership.');
  if ((dues > 0 || donation > 0) && method === 'None') throw Error('Choose how the member will pay.');
  if (received && method === 'None') throw Error('Choose a payment method for the amount received.');
  if (received && Number(received) > dues + donation) throw Error('Amount received exceeds dues plus donation.');
  const row = {
    EventName: currentEvent(),
    First: formValue('first'), Last: formValue('last'), 'Email Address': formValue('email'),
    Class: memberClass, Address1: formValue('address1'), Address2: formValue('address2'),
    City: formValue('city'), State: state, Zip: zip, Mobile: mobile,
    'Alt Phone': altPhone, MatchedFirst: selectedMember?.first ?? '',
    MatchedLast: selectedMember?.last ?? '', MatchedClass: selectedMember?.class ?? '',
    MatchedEmail: selectedMember?.email ?? '', Membership: membership, DuesAmount: money(dues),
    DonationAmount: money(donation), HowToPay: method,
    AmountPaid: method === 'Zelle' || method === 'PayPal' ? '' : received || 'None',
    SubmittedAt: editingSignin?.SubmittedAt ?? localTimestamp(new Date())
  };
  if (editingSignin) row.id = editingSignin.id;
  const changed = selectedMember && ['first', 'last', 'class', 'email', 'mobile', 'altPhone', 'address1', 'address2', 'city', 'state', 'zip']
    .some(field => (field === 'state' ? state : formValue(field)) !== (selectedMember[field] ?? ''));
  row.RecordStatus = guestMode
    ? entryForm.elements.namedItem('addByRequest').checked ? 'NEW BY REQUEST' : 'SIGNIN ONLY (NOT EBSC)'
    : !selectedMember ? 'NEW' : changed ? 'UPDATE' : 'NOCHANGE';
  return row;
}
function renderSignins() {
  const current = eventSignins();
  $('savedCount').textContent = `${current.length} sign-in${current.length === 1 ? '' : 's'} saved`;
  $('exportButton').disabled = current.length === 0;
  const list = $('savedList');
  list.replaceChildren();
  for (const row of [...current].reverse().slice(0, 10)) {
    const item = document.createElement('div');
    item.className = 'saved-row';
    const name = document.createElement('strong');
    name.textContent = `${row.First} ${row.Last}`;
    const time = document.createElement('small');
    time.textContent = row.SubmittedAt;
    item.append(name, time);
    list.append(item);
  }
  if (!current.length) list.textContent = 'No sign-ins yet for this event.';
}

function submissionForExport(row) {
  return {
    first: row.First, last: row.Last, email: row['Email Address'], class: row.Class,
    address1: row.Address1, address2: row.Address2, city: row.City, state: row.State,
    zip: row.Zip, mobile: row.Mobile, altPhone: row['Alt Phone'],
    matchedFirst: row.MatchedFirst, matchedLast: row.MatchedLast,
    matchedClass: row.MatchedClass, matchedEmail: row.MatchedEmail,
    membership: row.Membership, duesAmount: Number(row.DuesAmount),
    donationAmount: Number(row.DonationAmount), howToPay: row.HowToPay,
    amountPaid: row.AmountPaid && row.AmountPaid !== 'None' ? Number(row.AmountPaid) : null,
    submittedAt: row.SubmittedAt.replace(' ', 'T'), recordStatus: row.RecordStatus
  };
}

function exportFile() {
  const eventName = currentEvent();
  if (!eventName || !/^[a-z0-9_-]+$/i.test(eventName)) {
    message('Enter an event name using letters, numbers, hyphens, or underscores.');
    $('eventName').focus();
    return;
  }
  const current = eventSignins();
  const payload = { schemaVersion: 1, eventName, submissions: current.map(submissionForExport) };
  const blob = new Blob([JSON.stringify(payload, null, 2), '\n'], { type: 'application/json;charset=utf-8' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = `${eventName}_SignUpList.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  message(`Exported ${current.length} sign-ins. Saved entries remain on this device.`);
}
async function init() {
  database = await openDatabase();
  const snapshot = await getSetting('snapshot');
  members = snapshot?.members ?? (await getSetting('members')) ?? [];
  snapshotSource = snapshot?.source ?? null;
  signins = await getSignins();
  $('eventName').value = (await getSetting('eventName')) ?? 'PrototypeEvent';
  updateEventTitle();
  renderMembers();
  renderSignins();
  showView('search');
  navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(() => {});
}

$('search').addEventListener('input', renderMembers);
for (const name of ['mobile', 'altPhone']) {
  entryForm.elements.namedItem(name).addEventListener('input', event => {
    event.target.value = event.target.value.replace(/[^+()0-9 -]/g, '');
  });
}
entryForm.elements.namedItem('zip').addEventListener('input', event => {
  event.target.value = event.target.value.replace(/[^0-9-]/g, '');
});
entryForm.elements.namedItem('state').addEventListener('input', event => {
  event.target.value = event.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
});
entryForm.elements.namedItem('donation').addEventListener('input', event => {
  const parts = event.target.value.replace(/[^0-9.]/g, '').split('.');
  event.target.value = parts[0] + (parts.length > 1 ? `.${parts.slice(1).join('').slice(0, 2)}` : '');
});
$('newButton').addEventListener('click', () => startEntry(null));
$('guestToggle').addEventListener('change', event => {
  if (event.target.checked) startEntry(null, true);
  else { guestMode = false; showView('search'); }
});
$('cancelButton').addEventListener('click', () => {
  guestMode = false;
  $('guestToggle').checked = false;
  showView('search');
});
$('organizerButton').addEventListener('click', () => {
  const pin = prompt('Organizer PIN');
  if (pin === null) return;
  if (pin !== '1234') { message('Incorrect Organizer PIN.'); return; }
  showView('organizer');
});
$('startSigninButton').addEventListener('click', () => {
  guestMode = false;
  $('guestToggle').checked = false;
  $('search').value = '';
  renderMembers();
  showView('search');
});
$('sampleButton').addEventListener('click', async () => {
  if (members.length && !confirm('Replace the current member snapshot with fabricated sample members? Saved sign-ins will remain.')) return;
  try {
    pendingImport = null;
    $('importReview').hidden = true;
    await replaceMembers(SAMPLE_MEMBERS, { type: 'sample' });
  } catch (error) { message(error.message); }
});
$('importFile').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  pendingImport = null;
  $('importReview').hidden = true;
  try {
    const parsed = parseSnapshot(JSON.parse(await file.text()));
    pendingImport = { ...parsed, fileName: file.name };
    $('importName').textContent = file.name;
    $('importDetails').textContent = `${parsed.members.length} members · Exported ${snapshotDate(parsed.exportedAt).toLocaleString()} · Current list: ${members.length} members`;
    $('importReview').hidden = false;
    $('importReview').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    message('Review the snapshot before using it.');
  } catch (error) { message(`Import failed: ${error.message}`); }
  finally { event.target.value = ''; }
});
$('cancelImportButton').addEventListener('click', () => {
  pendingImport = null;
  $('importReview').hidden = true;
  message('Snapshot import canceled.');
});
$('useImportButton').addEventListener('click', async () => {
  if (!pendingImport) return;
  $('useImportButton').disabled = true;
  try {
    await replaceMembers(pendingImport.members,
      { type: 'ebsc', exportedAt: pendingImport.exportedAt, fileName: pendingImport.fileName });
    pendingImport = null;
    $('importReview').hidden = true;
  } catch (error) { message(`Import failed: ${error.message}`); }
  finally { $('useImportButton').disabled = false; }
});
$('eventName').addEventListener('change', async event => {
  try { await putSetting('eventName', clean(event.target.value)); updateEventTitle(); renderSignins(); }
  catch (error) { message(`Event name was not saved: ${error.message}`); }
});
entryForm.addEventListener('submit', async event => {
  event.preventDefault();
  const completeButton = entryForm.querySelector('button[type="submit"]');
  if (completeButton.disabled) return;
  completeButton.disabled = true;
  try {
    if (!currentEvent() || !/^[a-z0-9_-]+$/i.test(currentEvent())) throw Error('Enter an event name using letters, numbers, hyphens, or underscores.');
    const row = makeSignin();
    await saveSignin(row);
    signins = await getSignins();
    renderSignins();
    guestMode = false;
    editingSignin = null;
    $('guestToggle').checked = false;
    $('search').value = '';
    renderMembers();
    showView('search');
    message(`${row.First} ${row.Last} information saved. Thank you!`);
  } catch (error) { message(`Sign-in was not saved: ${error.message}`); }
  finally { completeButton.disabled = false; }
});
$('exportButton').addEventListener('click', exportFile);
init().catch(error => message(`Local storage is unavailable: ${error.message}`));
