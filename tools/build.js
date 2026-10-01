// Build dist/index.html: inline fonts, CSS and JS into one self-contained file.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));
let html = read('src/index.html');
const css = (exists('src/fonts.css') ? read('src/fonts.css') : '') + '\n' + read('src/style.css');
const jsFiles = ['src/vendor/theory.js', 'src/vendor/shapes.js', 'src/songparse.js', 'src/store.js', 'src/sync.js', 'src/sync-ui.js', 'src/app.js'].filter(exists);
const js = jsFiles.map(read).join('\n;\n');
html = html.replace('<!--STYLE-->', () => '<style>\n' + css + '\n</style>');
html = html.replace('<!--SCRIPT-->', () => '<script>\n' + js.replace(/<\/script/gi, '<\\/script') + '\n</script>');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/index.html'), html);
console.log('dist/index.html', Buffer.byteLength(html), 'bytes from', jsFiles.join(', '));
