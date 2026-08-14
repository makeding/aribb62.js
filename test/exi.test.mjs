import assert from 'node:assert/strict';
import {decodeARIBTTMLExi} from '../dist/aribb62.js';

const schemaLessSample = new Uint8Array([
    128, 6, 90, 29, 29, 28, 14, 139, 203, 221, 221, 221, 203, 157, 204,
    203, 155, 220, 153, 203, 219, 156, 203, 221, 29, 27, 91, 0, 221, 29,
    40, 10, 196, 222, 200, 243, 64, 39, 12, 21, 21, 97, 36, 0
]);

assert.equal(
    decodeARIBTTMLExi(schemaLessSample, 2),
    "<ns0:tt xmlns:ns0='http://www.w3.org/ns/ttml'><ns0:body><ns0:p>EXI</ns0:p></ns0:body></ns0:tt>"
);

console.log('built-in EXI schema-less decoder: ok');
