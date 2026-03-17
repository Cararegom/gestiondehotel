const fs = require('fs');

const filepath = 'C:/Users/AG-ve/OneDrive/Desktop/gestiondehotel/js/modules/mapa-habitaciones/modales-gestion.js';
let content = fs.readFileSync(filepath, 'utf8');

function removeFunction(fnName, content) {
    let startStr = `async function ${fnName}(`;
    let res = content;
    // We want to keep the first one and remove the subsequent ones
    let firstFound = false;

    while (true) {
        let startIdx = res.indexOf(startStr);
        if (startIdx === -1) break;

        let prevChar = res[startIdx - 1];
        if (res.substring(startIdx - 7, startIdx) === 'export ') {
            // Change it temporarily so indexOf doesn't find it
            res = res.substring(0, startIdx) + "XZXZX_export_async_function_" + fnName + res.substring(startIdx + startStr.length - 1);
            continue;
        }

        if (!firstFound) {
            // Keep the first one by renaming it temporarily
            firstFound = true;
            res = res.substring(0, startIdx) + "XZXZX_first_async_function_" + fnName + res.substring(startIdx + startStr.length - 1);
            continue;
        }

        let openBraces = 0;
        let endIdx = -1;
        let inString = false;
        let strChar = '';

        for (let i = startIdx; i < res.length; i++) {
            const char = res[i];
            if (inString) {
                if (char === strChar && res[i - 1] !== '\\') {
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
            console.log(`Removing non-first duplicate of ${fnName} size: ${endIdx - startIdx}`);
            res = res.substring(0, startIdx) + res.substring(endIdx);
        } else {
            console.log('Failed to find matching brace');
            break;
        }
    }

    res = res.replace(new RegExp(`XZXZX_export_async_function_${fnName}`, 'g'), `async function ${fnName}(`);
    res = res.replace(new RegExp(`XZXZX_first_async_function_${fnName}`, 'g'), `async function ${fnName}(`);
    return res;
}

content = removeFunction('puedeHacerCheckIn', content);
fs.writeFileSync(filepath, content);
console.log('Duplicate removed.');
