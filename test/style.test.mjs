import assert from 'node:assert/strict';
import {applyARIBMarquee, applyTTMLBorder} from '../src/utils/style.js';

const borderElement = {style: {}};
applyTTMLBorder(borderElement, {
    borderTop: 'solid 4px #ff0000ff',
    borderBottom: 'dashed 2px white'
}, 0.5);
assert.equal(borderElement.style.borderTop, 'solid 2px rgba(255, 0, 0, 1)');
assert.equal(borderElement.style.borderBottom, 'dashed 1px #ffffff');
assert.equal(borderElement.style.webkitTextStroke, undefined);

const verticalMarquee = {style: {}};
applyARIBMarquee(verticalMarquee, 'slide forward fast 2', 'tbrl');
assert.equal(verticalMarquee.style.animationName, 'aribb62-marquee-slide-y-forward');
assert.equal(verticalMarquee.style.animationDuration, '6s');
assert.equal(verticalMarquee.style.animationIterationCount, '2');
assert.equal(verticalMarquee.style.animationFillMode, 'forwards');

const horizontalMarquee = {style: {}};
applyARIBMarquee(horizontalMarquee, 'alternate reverse normal infinite', 'lrtb');
assert.equal(horizontalMarquee.style.animationName, 'aribb62-marquee-alternate-x-reverse');
assert.equal(horizontalMarquee.style.animationIterationCount, 'infinite');
assert.equal(horizontalMarquee.style.animationDirection, 'normal');

console.log('ARIB border and marquee mapping: ok');
