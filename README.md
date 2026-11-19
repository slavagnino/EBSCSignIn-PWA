# EBSC sign-in PWA prototype

This static prototype runs offline after its first online load. Member snapshots and sign-ins stay in the browser's IndexedDB on the device. The repository contains only fabricated sample members. Nothing in the app sends member information to a server.

## Try it locally

From this folder, run `python -m http.server 8000`, then open `http://localhost:8000/`. Click **Load sample members**, search for `Ada`, save a sign-in, reload, and export the text file. The export uses the 22-column header expected by EBSCUpdater. Keep a copy of exports: browser storage can be lost if the app or browser data is removed.

For an iPad test, host the static files over HTTPS (for example, GitHub Pages). Open the site in Safari, add it to the Home Screen, launch it once online, then test it with network access off. Publishing the repository uploads only app code and fabricated sample data; imported member files and sign-ins stay on the iPad.

## Import format

The **Import member JSON** button accepts an array of objects. Each object needs `last` and `class`. Supported keys are `first`, `last`, `class`, `email`, `address1`, `address2`, `city`, `state`, `zip`, `mobile`, and `altPhone`. For example:

```json
[
  { "first": "Ada", "last": "Example", "class": "2002", "email": "ada@example.invalid" }
]
```

This is a prototype format, not yet a workbook export tool. Importing replaces the local member snapshot and leaves saved sign-ins intact. Changing the event name switches the visible sign-in list; entries for other events remain stored on the same device.

## Manual checks

- [ ] Load sample members, search for Ada, select her, and save a sign-in. Confirm the saved count increases.
- [ ] Close and reopen the app. Confirm Ada's sign-in is still listed.
- [ ] Turn off network access after opening the installed app once. Reopen it, search for Bea, and save her sign-in.
- [ ] Export the event file. Confirm the download contains the 22-column header and the saved rows; open it with EBSCUpdater using a test workbook only.
