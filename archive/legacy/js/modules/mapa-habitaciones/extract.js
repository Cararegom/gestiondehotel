const fs = require('fs');

const extractModal = () => {
    const content = fs.readFileSync('C:/Users/AG-ve/OneDrive/Desktop/gestiondehotel/js/modules/mapa-habitaciones/mapa-habitaciones.github.js', 'utf8');
    const startStr = 'async function showHabitacionOpcionesModal(';
    const startIdx = content.indexOf(startStr);
    if (startIdx === -1) {
        console.log('Function not found.');
        return;
    }

    let openBraces = 0;
    let endIdx = -1;
    let inString = false;
    let strChar = '';

    for (let i = startIdx; i < content.length; i++) {
        const char = content[i];

        if (inString) {
            if (char === strChar && content[i - 1] !== '\\') {
                inString = false;
            }
        } else {
            if (char === "'" || char === '"' || char === '\`') {
                inString = true;
                strChar = char;
            } else if (char === '{') {
                openBraces++;
            } else if (char === '}') {
                openBraces--;
                if (openBraces === 0) {
                    endIdx = i + 1;
                    break;
                }
            }
        }
    }

    if (endIdx !== -1) {
        let fnContent = content.substring(startIdx, endIdx);
        // Add export and turnoService parameter
        fnContent = 'export ' + fnContent.replace(
            'async function showHabitacionOpcionesModal(room, supabase, currentUser, hotelId, mainAppContainer)',
            'async function showHabitacionOpcionesModal(room, supabase, currentUser, hotelId, mainAppContainer, turnoService)'
        );
        fs.writeFileSync('C:/Users/AG-ve/OneDrive/Desktop/gestiondehotel/js/modules/mapa-habitaciones/extracted-modal.js', fnContent);
        console.log('Successfully extracted modal logic. Length:', fnContent.length);
    } else {
        console.log('Failed to find matching brace.');
    }
};

extractModal();
