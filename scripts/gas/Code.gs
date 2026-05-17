/**
 * Deploy this Apps Script as Web App.
 * Script Properties required:
 * - GAS_UPLOAD_SHARED_SECRET
 * - GOOGLE_DRIVE_FOLDER_ID
 */
const SHARED_SECRET = PropertiesService.getScriptProperties().getProperty('GAS_UPLOAD_SHARED_SECRET');
const ROOT_FOLDER_ID = PropertiesService.getScriptProperties().getProperty('GOOGLE_DRIVE_FOLDER_ID');

function doPost(e) {
  try {
    if (!SHARED_SECRET || !ROOT_FOLDER_ID) {
      return jsonResponse({ success: false, error: 'Missing GAS script properties' });
    }

    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!payload || payload.secret !== SHARED_SECRET) {
      return jsonResponse({ success: false, error: 'Unauthorized' });
    }

    if (!payload.imageBase64 || !payload.fileName) {
      return jsonResponse({ success: false, error: 'Missing image payload' });
    }

    const mimeType = payload.mimeType || 'image/jpeg';
    const fileName = sanitizeName(payload.fileName);
    const folderId = ensureFolderPath(ROOT_FOLDER_ID, payload.folderHint || '');
    const bytes = Utilities.base64Decode(payload.imageBase64);
    const blob = Utilities.newBlob(bytes, mimeType, fileName);
    const file = DriveApp.getFolderById(folderId).createFile(blob).setName(fileName);
    const driveLink = 'https://drive.google.com/file/d/' + file.getId() + '/view';

    return jsonResponse({
      success: true,
      driveLink: driveLink,
      driveFileId: file.getId(),
    });
  } catch (error) {
    return jsonResponse({
      success: false,
      error: String(error && error.message ? error.message : error),
    });
  }
}

function ensureFolderPath(rootFolderId, folderHint) {
  const rootFolder = DriveApp.getFolderById(rootFolderId);
  const parts = String(folderHint || '')
    .split('/')
    .map(function (part) { return sanitizeName(part); })
    .filter(Boolean);

  if (parts.length === 0) return rootFolder.getId();

  let current = rootFolder;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    const found = current.getFoldersByName(part);
    current = found.hasNext() ? found.next() : current.createFolder(part);
  }

  return current.getId();
}

function sanitizeName(value) {
  return String(value || '').replace(/[\/\\:*?"<>|]/g, '_').trim();
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
