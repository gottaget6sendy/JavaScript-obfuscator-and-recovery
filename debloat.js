#!/usr/bin/env node

const fs = require('fs');
const crypto = require('crypto');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');

function usageAndExit() {
  console.error('Usage: node debloat.js [--stealth] input.bloated.js output.debloated.js PASSWORD');
  process.exit(1);
}

const argv = process.argv.slice(2);
let stealth = false;
if (argv.length && argv[0] === '--stealth') { stealth = true; argv.shift(); }
if (argv.length < 3) usageAndExit();
const [inputFile, outFile, password] = argv;

let source = fs.readFileSync(inputFile, 'utf8');

const mapMatch = source.match(/\/\*BLOAT_MAP:([A-Za-z0-9+/=]+)\*\//);
let encrypted = null;

if (mapMatch) encrypted = mapMatch[1];
if ((!encrypted) && (stealth || !mapMatch)) {
  const stealthMatch = source.match(/var\s+([A-Za-z0-9_]+)\s*=\s*\(function\(\)\s*\{\s*var\s+_[a-zA-Z0-9]+\s*=\s*"([A-Za-z0-9+/=]{40,})";\s*_[a-zA-Z0-9]+\s*\+=\s*"([A-Za-z0-9+/=]{0,})";\s*return\s+_[a-zA-Z0-9]+;\s*\}\)\s*\(\)\s*;/);
  if (stealthMatch) {
    const part1 = stealthMatch[2] || '';
    const part2 = stealthMatch[3] || '';
    encrypted = (part1 + part2);
  } else {
    const liberal = source.match(/["']([A-Za-z0-9+/=]{80,})["']/);
    if (liberal) encrypted = liberal[1];
  }
}

if (!encrypted) {
  console.error('No embedded map found in file.');
  process.exit(2);
}

//decrption part dont forget
function decryptJSON(b64, pass) {
  const data = Buffer.from(b64, 'base64');
  const salt = data.slice(0,16);
  const iv = data.slice(16,28);
  const tag = data.slice(28,44);
  const encrypted = data.slice(44);
  const key = crypto.pbkdf2Sync(pass, salt, 150000, 32, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(out.toString('utf8'));
}

let map;
try {
  map = decryptJSON(encrypted, password);
} catch (e) {
  console.error('Failed to decrypt map — wrong password or corrupted map.');
  process.exit(3);
}


source = source.replace(/\/\*BLOAT_MAP:[A-Za-z0-9+/=]+\*\//, '');


if (map.stealthVarName) {
  const rv = new RegExp('var\\s+' + map.stealthVarName + '\\s*=\\s*\\(function\\([\\s\\S]*?\\)\\)\\(\\)\\s*;','g');
  source = source.replace(rv, '');
} else {

  source = source.replace(/var\s+[A-Za-z0-9_]+\s*=\s*\(function\(\)\s*\{[\s\S]*?\}\)\(\)\s*;/g, '');
}

let noJunk = source;
for (const id of (map.junkIds || [])) {
  const re = new RegExp(`/\\*BLOAT_JUNK_START:${id}\\*/[\\s\\S]*?/\\*BLOAT_JUNK_END:${id}\\*/`, 'g');
  noJunk = noJunk.replace(re, '');
}

const ast = parser.parse(noJunk, {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'dynamicImport']
});

traverse(ast, {
  CallExpression(path) {
    if (t.isIdentifier(path.node.callee, { name: '__bloat_decode' }) && path.node.arguments.length === 1 && t.isStringLiteral(path.node.arguments[0])) {
      const b64 = path.node.arguments[0].value;
      try {
        const val = Buffer.from(b64, 'base64').toString('utf8');
        path.replaceWith(t.stringLiteral(val));
      } catch (e) {}
    }
  }
});

traverse(ast, {
  Program(path) {
    const renames = map.renames || {};
    Object.keys(renames).forEach(newName => {
      const oldName = renames[newName];
      try {
        const binding = path.scope.getBinding(newName);
        if (binding) {
          path.scope.rename(newName, oldName);
        } else {
          path.traverse({
            Identifier(p) {
              if (p.node.name === newName) p.node.name = oldName;
            }
          });
        }
      } catch (e) {}
    });
  }
});

// remove decoder helper
traverse(ast, {
  FunctionDeclaration(path) {
    if (path.node.id && path.node.id.name === '__bloat_decode') path.remove();
  }
});

const { code } = generate(ast, { comments: true });
fs.writeFileSync(outFile, code, 'utf8');
console.log('Debloating complete. Output:', outFile);
