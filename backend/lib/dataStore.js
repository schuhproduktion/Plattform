const fs = require('fs/promises');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJson(fileName, fallback = null) {
  await ensureDataDir();
  const filePath = path.join(DATA_DIR, fileName);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      if (fallback !== null) {
        await writeJson(fileName, fallback);
        return fallback;
      }
      return null;
    }
    throw err;
  }
}

async function writeJson(fileName, data) {
  await ensureDataDir();
  const filePath = path.join(DATA_DIR, fileName);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return data;
}

async function appendToArray(fileName, entry) {
  const list = (await readJson(fileName, [])) || [];
  list.push(entry);
  await writeJson(fileName, list);
  return entry;
}

module.exports = {
  DATA_DIR,
  readJson,
  writeJson,
  appendToArray
};
