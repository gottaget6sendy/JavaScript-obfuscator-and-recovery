
# JS Bloater / Debloater 

Files:
- bloat.js       - obfuscates  JS code (Junk code insertion/bloating)
- debloat.js     - reverses the bloat using the password
- package.json   - npm metadata

How to work.
1. Install Node package manager :
   npm install

2. Bloat:
   node bloat.js [--exclude=foo,bar] [--stealth] sample/input.js sample/input.bloated.js YourPasswordHere

3. Debloat:
   node debloat.js [--stealth] sample/input.bloated.js sample/input.recovered.js YourPasswordHere

