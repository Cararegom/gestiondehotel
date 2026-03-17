const fs = require('fs');
const https = require('https');

// Fix modales-gestion.js HTML template manually
let mg = fs.readFileSync('modales-gestion.js', 'utf8');
const recuperadasIndex = mg.indexOf('// --- FUNCIONES RECUPERADAS ---');
if(recuperadasIndex !== -1) {
    mg = mg.substring(0, recuperadasIndex); // strip ruined functions
}

// Fix missing modalHTML template
if(!mg.includes('const modalHTML =')) {
    const target = '         `;';
    const splitIndex = mg.indexOf(target) + target.length;
    const part1 = mg.substring(0, splitIndex);
    const part2 = mg.substring(splitIndex);
    
    const template = `\n\n    const modalHTML = \`
         <div class="bg-white rounded-lg shadow-xl w-full max-w-md p-6 relative flex flex-col animate-fade-in-up border-t-4 \\${room.estado === 'ocupada' ? 'border-yellow-500' : (room.estado === 'disponible' ? 'border-green-500' : 'border-gray-500')}">
              <button id="close-opc-btn" class="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
                  <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
              
              <div class="mb-6">
                  <h3 class="text-2xl font-bold text-gray-800">\\${room.nombre}</h3>
                  <p class="text-sm text-gray-500">Opciones de gesti&oacute;n</p>
              </div>

              <div class="grid grid-cols-2 gap-3 mb-2">
                  \\${optionsHTML}
              </div>
         </div>
    \`;\n`;
    mg = part1 + template + part2;
}

fs.writeFileSync('modales-gestion.js', mg.trim() + '\n\n// --- FUNCIONES RECUPERADAS ---\n');

let ma = fs.readFileSync('modales-alquiler.js', 'utf8');
const recIndexA = ma.indexOf('// --- FUNCIONES RECUPERADAS ---');
if(recIndexA !== -1) {
    ma = ma.substring(0, recIndexA);
}
fs.writeFileSync('modales-alquiler.js', ma.trim() + '\n\n// --- FUNCIONES RECUPERADAS ---\n');

const url = 'https://raw.githubusercontent.com/Cararegom/gestiondehotel/main/js/modules/mapa-habitaciones/mapa-habitaciones.js';
https.get(url, (res) => {
    let raw = '';
    res.on('data', d => raw += d);
    res.on('end', () => {
        const extract = (name) => {
            const regex = new RegExp(`(?:export )?(?:async )?function ${name}\\b[\\s\\S]+?^}`, 'm');
            const match = raw.match(regex);
            return match ? match[0] : '';
        };
        
        const f1 = extract('showEnhancedServiciosModal').replace(/^function/, 'export function');
        const f2 = extract('showReservaFuturaModal').replace(/^async function/, 'export async function');
        const f3 = extract('showSeguimientoArticulosModal').replace(/^async function/, 'export async function');
        const f4 = extract('mostrarModalConsumosLocal').replace(/^async function/, 'export async function');
        
        fs.appendFileSync('modales-gestion.js', [f1, f2, f3, f4].join('\n\n') + '\n');
        
        const f5 = extract('imprimirConsumosHabitacion').replace(/^async function/, 'export async function').replace(/^export export/, 'export');
        const f6 = extract('imprimirFacturaPosAdaptable').replace(/^function/, 'export function').replace(/^export export/, 'export');
        
        fs.appendFileSync('modales-alquiler.js', [f5, f6].join('\n\n') + '\n');
        
        console.log("Done.");
    });
});
