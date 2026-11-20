import { clean, validateMember, parseSnapshot, snapshotDate } from './snapshot-format.mjs';

const HEADERS = [
  'First', 'Last', 'Email Address', 'Class', 'Address1', 'Address2',
  'City', 'State', 'Zip', 'Mobile', 'Alt Phone', 'MatchedFirst',
  'MatchedLast', 'MatchedClass', 'MatchedEmail', 'Membership', 'DuesAmount',
  'DonationAmount', 'HowToPay', 'AmountPaid', 'SubmittedAt', 'RecordStatus'
];

const SAMPLE_MEMBERS = [
  { first: 'Ada', last: 'Example', class: '2002', email: 'ada@example.invalid', city: 'Sampletown', state: 'CA' },
  { first: 'Bea', last: 'Sample', class: '2015', email: 'bea@example.invalid', city: 'Example City', state: 'MA' },
  { first: 'Cora', last: 'Demonstration', class: '1998', email: 'cora@example.invalid' }
];

const $ = id => document.getElementById(id);
const entryForm = $('entryForm');
let database;
let members = [];
let signins = [];
let selectedMember = null;
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
const addSignin = row => operation('signins', 'readwrite', store => store.add(row));

function message(text) { $('message').textContent = text; }
function money(value) { return Number(value || 0).toFixed(2); }
function localTimestamp(date) {
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function replaceMembers(values, source) {
  const checked = values.map(validateMember);
  await putSnapshot({ members: checked, source });
  members = checked;
  snapshotSource = source;
  renderMembers();
  message(`${members.length} members stored on this device.`);
}

function renderMembers() {
  const sourceText = snapshotSource?.exportedAt
    ? ` Snapshot exported ${snapshotDate(snapshotSource.exportedAt).toLocaleString()}.`
    : snapshotSource?.type === 'sample' ? ' Fabricated sample data.' : '';
  $('memberCount').textContent = `${members.length} members stored on this device.${sourceText}`;
  const term = $('search').value.trim().toLocaleLowerCase();
  const results = $('results');
  results.replaceChildren();
  if (!term) return;
  const matches = members.filter(member =>
    `${member.first} ${member.last} ${member.email}`.toLocaleLowerCase().includes(term)).slice(0, 30);
  for (const member of matches) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'result';
    const name = document.createElement('strong');
    name.textContent = `${member.first} ${member.last}`;
    const context = document.createElement('small');
    context.textContent = `${member.class} · ${member.email}`;
    button.append(name, context);
    button.addEventListener('click', () => startEntry(member));
    results.append(button);
  }
  if (!matches.length) results.textContent = 'No matching members. You can sign in someone new.';
}

function startEntry(member) {
  selectedMember = member;
  entryForm.reset();
  for (const field of ['first', 'last', 'class', 'email', 'mobile', 'address1', 'city', 'state', 'zip']) {
    entryForm.elements.namedItem(field).value = member?.[field] ?? '';
  }
  $('entryTitle').textContent = member ? `Sign in ${member.first} ${member.last}` : 'New sign-in';
  $('entryCard').hidden = false;
  $('entryCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  entryForm.elements.namedItem(member ? 'mobile' : 'first').focus();
}

function formValue(name) { return clean(entryForm.elements.namedItem(name).value); }

function makeSignin() {
  const membership = formValue('membership');
  const dues = Number(formValue('dues') || 0);
  const donation = Number(formValue('donation') || 0);
  const method = formValue('method');
  const received = formValue('received');
  if (membership === 'None' && dues > 0) throw Error('Choose a membership for a dues amount.');
  if (membership !== 'None' && dues <= 0) throw Error('Enter a dues amount for the membership.');
  if ((dues > 0 || donation > 0) && method === 'None') throw Error('Choose how the member will pay.');
  if (received && method === 'None') throw Error('Choose a payment method for the amount received.');
  if (received && Number(received) > dues + donation) throw Error('Amount received exceeds dues plus donation.');
  const row = {
    EventName: currentEvent(),
    First: formValue('first'), Last: formValue('last'), 'Email Address': formValue('email'),
    Class: formValue('class'), Address1: formValue('address1'), Address2: selectedMember?.address2 ?? '',
    City: formValue('city'), State: formValue('state'), Zip: formValue('zip'), Mobile: formValue('mobile'),
    'Alt Phone': selectedMember?.altPhone ?? '', MatchedFirst: selectedMember?.first ?? '',
    MatchedLast: selectedMember?.last ?? '', MatchedClass: selectedMember?.class ?? '',
    MatchedEmail: selectedMember?.email ?? '', Membership: membership, DuesAmount: money(dues),
    DonationAmount: money(donation), HowToPay: method,
    AmountPaid: method === 'Zelle' || method === 'PayPal' ? '' : received || 'None',
    SubmittedAt: localTimestamp(new Date())
  };
  const changed = selectedMember && ['first', 'last', 'class', 'email', 'mobile', 'address1', 'city', 'state', 'zip']
    .some(field => formValue(field) !== (selectedMember[field] ?? ''));
  row.RecordStatus = !selectedMember ? 'NEW' : changed ? 'UPDATE' : 'NOCHANGE';
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

function exportFile() {
  const eventName = currentEvent();
  if (!eventName || !/^[a-z0-9_-]+$/i.test(eventName)) {
    message('Enter an event name using letters, numbers, hyphens, or underscores.');
    $('eventName').focus();
    return;
  }
  const current = eventSignins();
  const lines = [HEADERS.join('\t'), ...current.map(row => HEADERS.map(key => clean(row[key])).join('\t'))];
  const blob = new Blob(['\uFEFF', lines.join('\r\n'), '\r\n'], { type: 'text/plain;charset=utf-8' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = `${eventName}_SignUpList.txt`;
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
  renderMembers();
  renderSignins();
  navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(() => {});
}

$('search').addEventListener('input', renderMembers);
$('newButton').addEventListener('click', () => startEntry(null));
$('cancelButton').addEventListener('click', () => { $('entryCard').hidden = true; });
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
  try { await putSetting('eventName', clean(event.target.value)); renderSignins(); }
  catch (error) { message(`Event name was not saved: ${error.message}`); }
});
entryForm.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    if (!currentEvent() || !/^[a-z0-9_-]+$/i.test(currentEvent())) throw Error('Enter an event name using letters, numbers, hyphens, or underscores.');
    const row = makeSignin();
    await addSignin(row);
    signins = await getSignins();
    renderSignins();
    $('entryCard').hidden = true;
    $('search').value = '';
    renderMembers();
    message(`${row.First} ${row.Last} saved on this device.`);
  } catch (error) { message(`Sign-in was not saved: ${error.message}`); }
});
$('exportButton').addEventListener('click', exportFile);
window.addEventListener('online', updateConnectivity);
window.addEventListener('offline', updateConnectivity);
function updateConnectivity() { $('offlineBadge').textContent = navigator.onLine ? 'Online' : 'Offline'; }
updateConnectivity();
init().catch(error => message(`Local storage is unavailable: ${error.message}`));
