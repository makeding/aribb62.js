/* Generated from ARIB STD-B62 v2.2 Annex 1 XSD. */
import {Grammars} from '@selfmadesystem/exificient.js/grammars/Grammars';
import grammar from '../grammar/arib-ttml.grs.json';

export function createARIBTTMLGrammars() {
    return Grammars.fromJson(grammar);
}
