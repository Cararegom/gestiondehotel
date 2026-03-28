const fs = require('fs');

const githubFile = 'C:/Users/AG-ve/OneDrive/Desktop/gestiondehotel/js/modules/mapa-habitaciones/mapa-habitaciones.github.js';
const targetFile = 'C:/Users/AG-ve/OneDrive/Desktop/gestiondehotel/js/modules/mapa-habitaciones/modales-alquiler.js';

let githubContent = fs.readFileSync(githubFile, 'utf8');
let targetContent = fs.readFileSync(targetFile, 'utf8');

function extractFunction(fnName, content) {
    let startIdx = content.indexOf(`async function ${fnName}(`);
    if (startIdx === -1) {
        startIdx = content.indexOf(`export async function ${fnName}(`);
    }
    if (startIdx === -1) return null;

    let openBraces = 0;
    let endIdx = -1;
    let foundFirstBrace = false;
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
                foundFirstBrace = true;
            } else if (char === '}') {
                openBraces--;
                if (foundFirstBrace && openBraces === 0) {
                    endIdx = i + 1;
                    break;
                }
            }
        }
    }

    if (endIdx !== -1) {
        return content.substring(startIdx, endIdx);
    }
    return null;
}

const showAlquilarText = extractFunction('showAlquilarModal', githubContent);
const showExtenderText = extractFunction('showExtenderTiempoModal', githubContent);

if (showAlquilarText && showExtenderText) {
    console.log("Extracted both successfully!");

    // Replace the dummy ones in target
    targetContent = targetContent.replace(/export async function showAlquilarModal[\s\S]*?\}\s*export async function showExtenderTiempoModal[\s\S]*?\}/,
        `export ${showAlquilarText}\n\nexport ${showExtenderText}`);

    fs.writeFileSync(targetFile, targetContent);
    console.log("Injected into modales-alquiler.js");
} else {
    console.log("Failed to extract:", {
        showAlquilar: !!showAlquilarText,
        showExtender: !!showExtenderText
    });
}
