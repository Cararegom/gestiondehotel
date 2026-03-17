const fs = require('fs');
const filepath = 'c:/Users/AG-ve/OneDrive/Desktop/gestiondehotel/js/modules/mapa-habitaciones/modales-alquiler.js';
let content = fs.readFileSync(filepath, 'utf8');

// Replace formatCurrency with formatCOP
content = content.replace(/formatCurrency/g, 'formatCOP');

// Replace renderRooms invocation with CustomEvent
content = content.replace(/await renderRooms\(mainAppContainer.*?;\s*/g, "document.dispatchEvent(new CustomEvent('renderRoomsComplete', { detail: { action: 'refresh' } }));\n");

// showGlobalLoading and hideGlobalLoading are needed
// If not imported, we add them to the import { formatCOP... } line
if (!content.includes('showGlobalLoading')) {
    content = content.replace(/import { formatCOP, (.*?) } from '\.\/helpers\.js';/, "import { formatCOP, $1 } from './helpers.js';\nimport { showGlobalLoading, hideGlobalLoading, showError } from '../../uiUtils.js';\n");
}

fs.writeFileSync(filepath, content);
console.log('Fixed modales-alquiler.js missing globals');
