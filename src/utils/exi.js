import {EXIDecoder} from '@selfmadesystem/exificient.js/decoder/EXIDecoder';
import {XMLEventHandler} from '@selfmadesystem/exificient.js/XMLEventHandler';
import {Grammars} from '@selfmadesystem/exificient.js/grammars/Grammars';
import {createARIBTTMLGrammars} from './exi-grammar.js';

let aribTTMLGrammars = null;

function getGrammars(compressionType) {
    if (compressionType === 2) {
        return Grammars.fromJson(null);
    }
    if (compressionType === 1) {
        if (!aribTTMLGrammars) {
            aribTTMLGrammars = createARIBTTMLGrammars();
        }
        return aribTTMLGrammars;
    }
    throw new Error(`Unsupported ARIB-TTML compression type: ${compressionType}`);
}

export function decodeARIBTTMLExi(bytes, compressionType) {
    const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const decoder = new EXIDecoder(getGrammars(Number(compressionType)));
    const handler = new XMLEventHandler();
    decoder.registerEventHandler(handler);
    decoder.decode(input);
    return handler.getXML();
}
