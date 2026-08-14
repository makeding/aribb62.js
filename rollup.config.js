import fs from 'node:fs';
import {nodeResolve} from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';

function grammarAssetPlugin() {
    return {
        name: 'arib-ttml-grammar-asset',
        load(id) {
            if (!id.endsWith('/arib-ttml.grs.json')) {
                return null;
            }
            const grammar = fs.readFileSync(id, 'utf8').trim();
            return `export default ${grammar};`;
        }
    };
}

function exificientCompatibilityPlugin() {
    return {
        name: 'exificient-compatibility',
        transform(code, id) {
            if (!id.endsWith('/@selfmadesystem/exificient.js/dist/decoder/EXIDecoder.js')) {
                return null;
            }
            const patched = code.replace(
                'uri: uri,\n            };',
                'uri: uri,\n                qnameContext: [],\n            };'
            );
            if (patched === code) {
                this.error('Expected EXIficient URI table initializer was not found');
            }
            return {code: patched, map: null};
        }
    };
}

export default {
    input: 'src/index.js',
    output: {
        file: 'dist/aribb62.js',
        format: 'es',
        sourcemap: false
    },
    plugins: [
        grammarAssetPlugin(),
        nodeResolve({extensions: ['.js']}),
        exificientCompatibilityPlugin(),
        terser()
    ]
};
