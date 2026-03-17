const fs = require('fs');
const filepath = 'C:/Users/AG-ve/OneDrive/Desktop/gestiondehotel/js/modules/mapa-habitaciones/modales-gestion.js';
const extractedPath = 'C:/Users/AG-ve/OneDrive/Desktop/gestiondehotel/js/modules/mapa-habitaciones/extracted-modal.js';
const githubPath = 'C:/Users/AG-ve/OneDrive/Desktop/gestiondehotel/js/modules/mapa-habitaciones/mapa-habitaciones.github.js';

let fullText = fs.readFileSync(filepath, 'utf8');
const originalModal = fs.readFileSync(extractedPath, 'utf8');
const githubFile = fs.readFileSync(githubPath, 'utf8');

// 1. Extract puedeHacerCheckIn
let checkInStart = githubFile.indexOf('async function puedeHacerCheckIn(');
let checkInContent = "";
if (checkInStart !== -1) {
    let braces = 0;
    for (let i = checkInStart; i < githubFile.length; i++) {
        if (githubFile[i] === '{') braces++;
        if (githubFile[i] === '}') {
            braces--;
            if (braces === 0) {
                checkInContent = githubFile.substring(checkInStart, i + 1);
                break;
            }
        }
    }
}

// 2. Extract showSeguimientoArticulosModal
let segStart = githubFile.indexOf('async function showSeguimientoArticulosModal(');
let segContent = "";
if (segStart !== -1) {
    let braces = 0;
    for (let i = segStart; i < githubFile.length; i++) {
        if (githubFile[i] === '{') braces++;
        if (githubFile[i] === '}') {
            braces--;
            if (braces === 0) {
                segContent = githubFile.substring(segStart, i + 1);
                break;
            }
        }
    }
}

// Substitute renderRooms with event dispatch
const modifiedModal = originalModal.replace(
    /await renderRooms\(mainAppContainer, supabase, currentUser, hotelId\);/g,
    "document.dispatchEvent(new CustomEvent('renderRoomsComplete', { detail: { action: 'refresh' } }));"
).replace( // Fix mostrarInfoModalGlobal imports
    /mostrarInfoModalGlobal\(/g,
    "window.mostrarInfoModalGlobal("
);

// We add a window alias just in case, since helpers.js exports it but modales-gestion didn't import it in the original version, BUT wait! We import it at top!
// Actually, let's just append the missing code to the end, and replace the main function.
const startRe = /export\s+async\s+function\s+showHabitacionOpcionesModal\([^)]*\)\s*{/;
const match = fullText.match(startRe);

if (match) {
    const startIndex = match.index;
    let braces = 0;
    let endIndex = -1;
    for (let i = startIndex; i < fullText.length; i++) {
        if (fullText[i] === '{') braces++;
        if (fullText[i] === '}') {
            braces--;
            if (braces === 0) {
                endIndex = i + 1;
                break;
            }
        }
    }

    if (endIndex !== -1) {
        let beforeContent = fullText.substring(0, startIndex);
        let afterContent = fullText.substring(endIndex);

        let newContent = beforeContent + "\n\n" + modifiedModal + "\n\n" + checkInContent + "\n\n" + segContent + "\n\n" + afterContent;

        // Also ensure mostrarInfoModalGlobal is imported if it isn't
        if (!newContent.includes('mostrarInfoModalGlobal')) {
            newContent = newContent.replace("import { formatCOP, waitForButtonAndBind, formatDateTime, getAmenityIcon, cerrarModalContainer } from './helpers.js';", "import { formatCOP, waitForButtonAndBind, formatDateTime, getAmenityIcon, cerrarModalContainer, mostrarInfoModalGlobal } from './helpers.js';");
        } else if (newContent.includes("import { formatCOP")) {
            newContent = newContent.replace("{ formatCOP, waitForButtonAndBind, formatDateTime, getAmenityIcon, cerrarModalContainer }", "{ formatCOP, waitForButtonAndBind, formatDateTime, getAmenityIcon, cerrarModalContainer, mostrarInfoModalGlobal }");
        }

        fs.writeFileSync(filepath, newContent);
        console.log('REPLACED showHabitacionOpcionesModal AND ADDED MISSING EXTRAS!');
    }
} else {
    console.log('Could not find start of showHabitacionOpcionesModal in fullText');
}
