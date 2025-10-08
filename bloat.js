#!/usr/bin/env node
/** funcs
 * --exclude :  list of identifiers to never rename
 * --stealth  : embeds  the encrypted map into a variable not a comment
 * Requires: npm install @babel/parser @babel/traverse @babel/generator @babel/types
 */

const fs = require('fs');
const crypto = require('crypto');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');
const path = require('path');

function usageAndExit() {
  console.error('Usage: node bloat.js [--exclude name1,name2] [--stealth] input.js output.bloated.js PASSWORD');
  process.exit(1);
}

const argv = process.argv.slice(2);
let stealth = false;
let excludeList = [];
while (argv.length && argv[0].startsWith('--')) {
  const f = argv.shift();
  if (f === '--stealth') stealth = true;
  else if (f.startsWith('--exclude')) {
    const parts = f.split('=');
    if (parts.length === 2) excludeList = parts[1].split(',').map(s => s.trim()).filter(Boolean);
    else {
      if (argv.length === 0) usageAndExit();
      excludeList = argv.shift().split(',').map(s => s.trim()).filter(Boolean);
    }
  } else usageAndExit();
}

if (argv.length < 3) usageAndExit();
const [inputFile, outFile, password] = argv;

const source = fs.readFileSync(inputFile, 'utf8');

const ast = parser.parse(source, {
  sourceType: 'module',
  plugins: ['jsx', 'classProperties', 'optionalChaining', 'dynamicImport']
});

const defaultReserved = new Set([
  'window','document','console','require','module','exports','global','globalThis',
  '__dirname','__filename','process','setTimeout','setInterval','clearTimeout','clearInterval',
  'Buffer','atob','btoa'
]);
excludeList.forEach(n => defaultReserved.add(n));

const cryptoRand = (n=8) => crypto.randomBytes(n).toString('hex').slice(0, n);
const base64 = s => Buffer.from(s, 'utf8').toString('base64');

const map = { renames: {}, strings: {}, junkIds: [], stealthVarName: null };

traverse(ast, {
  Program(path) {
    function processScope(scope) {
      Object.keys(scope.bindings).forEach(origName => {
        if (defaultReserved.has(origName)) return;
        // don't rename if user explicitly excluded
        if (excludeList.includes(origName)) return;
        const binding = scope.bindings[origName];
        if (!binding) return;
        const newName = '_' + cryptoRand(6);
        try {
          scope.rename(origName, newName);
          map.renames[newName] = origName;
        } catch (e) {
         
        }
      });
      if (scope.childScopes) scope.childScopes.forEach(processScope);
    }
    processScope(path.scope);
  }
});

let placeholderCounter = 0;
traverse(ast, {
  StringLiteral(path) {
    if (path.parent && (t.isImportDeclaration(path.parent) || t.isExportAllDeclaration(path.parent) || (t.isCallExpression(path.parent) && path.parent.callee && path.parent.callee.name === 'require') || t.isDirectiveLiteral(path.node))) {
      return;
    }
    const val = path.node.value;
    const b64 = base64(val);
    const call = t.callExpression(t.identifier('__bloat_decode'), [t.stringLiteral(b64)]);
    path.replaceWith(call);
    path.skip();
    
  }
});

const decoderFnAst = parser.parse(`
function __bloat_decode(s){
  try {
    if (typeof Buffer !== 'undefined') return Buffer.from(s,'base64').toString('utf8');
    if (typeof atob !== 'undefined') return atob(s);
  } catch(e) {}
  return s;
}
`, { sourceType: 'script' });
ast.program.body.unshift(...decoderFnAst.program.body);

// where the junk code is inserted 
const maxJunk = 4;
for (let i=0;i<maxJunk;i++){
  const id = cryptoRand(6);
  map.junkIds.push(id);
  const junkCode = `/*BLOAT_JUNK_START:${id}*/ (function(){ var a${id}=${Math.floor(Math.random()*10000)}; function z${id}(){ return a${id} + ${Math.floor(Math.random()*100)}; } try { z${id}(); } catch(e){} })() /*BLOAT_JUNK_END:${id}*/`;
  const junkAst = parser.parse(junkCode, { sourceType: 'script' });
  ast.program.body.splice(Math.max(1, Math.floor(Math.random() * ast.program.body.length)), 0, ...junkAst.program.body);
}

// Helper to encrypt map
function encryptJSON(obj, pass) {
  const iv = crypto.randomBytes(12);
  const salt = crypto.randomBytes(16);
  const key = crypto.pbkdf2Sync(pass, salt, 150000, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const json = JSON.stringify(obj);
  const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, tag, encrypted]).toString('base64');
}

const { code } = generate(ast, { compact: false, comments: true });

const encryptedMap = encryptJSON(map, password);

// If stealth mode, embed as a const with an innocuous-looking name and some random whitespace/newlines
let out;
if (stealth) {
  // choose a random var name
  const stealthVar = '__' + cryptoRand(8);
  map.stealthVarName = stealthVar;
  // Construct a small bootstrap that stores the base64 string into the var in an obfuscated way
  const p1 = stealthVar + ' = (function(){ var _a = "' + encryptedMap.slice(0,64) + '"; _a += "' + encryptedMap.slice(64) + '"; return _a; })();';
  out = code + '\n\n/* Stealth map below: variable intentionally opaque */\nvar ' + p1 + '\n';
} else {
  out = code + '\n\n/*BLOAT_MAP:' + encryptedMap + '*/\n';
}

fs.writeFileSync(outFile, out, 'utf8');
console.log('Bloating complete. Output:', outFile);
console.log('Keep your password safe to reverse the bloat.');
