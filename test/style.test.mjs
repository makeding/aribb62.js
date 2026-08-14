import assert from 'node:assert/strict';
import {
    applyARIBMarquee,
    applyTTMLBorder,
    keyframeStyleToCSS,
    parseARIBAnimation,
    parseTTMLTextStroke
} from '../src/utils/style.js';
import {mapWritingMode} from '../src/utils/style.js';
import {parseTTMLTime} from '../src/utils/ttml.js';

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

assert.deepEqual(parseTTMLTextStroke('#ff0000 8px 2px', 0.5), {
    width: 4,
    blur: 1,
    color: '#ff0000'
});
assert.deepEqual(parseTTMLTextStroke('#00ff00ff 2px 0px', 0.25), {
    width: 0.5,
    blur: 0,
    color: 'rgba(0, 255, 0, 1)'
});
assert.deepEqual(parseTTMLTextStroke('2px', 0.25), {
    width: 0.5,
    blur: 0,
    color: 'currentColor'
});
assert.equal(parseTTMLTextStroke('none', 1), null);
assert.equal(
    parseARIBAnimation('scroll 1000ms linear 0ms 1 normal'),
    'scroll 1000ms linear 0ms 1 normal both'
);
assert.deepEqual(
    keyframeStyleToCSS({
        origin: '340px 40px',
        extent: '300px 100px',
        fontSize: '46px'
    }, 0.25),
    [
        'font-size: 11.5px',
        'width: 75px',
        'height: 25px',
        'transform: translate(calc(85px - var(--aribb62-origin-x, 0px)), calc(10px - var(--aribb62-origin-y, 0px)))'
    ]
);
assert.deepEqual(mapWritingMode('lr'), {writingMode: 'horizontal-tb', direction: 'ltr'});
assert.deepEqual(mapWritingMode('rl'), {writingMode: 'horizontal-tb', direction: 'rtl'});
assert.deepEqual(mapWritingMode('tb'), {writingMode: 'vertical-lr', direction: ''});
assert.equal(parseTTMLTime('00:00:10:15', {frameRate: 30}), 10.5);
assert.equal(parseTTMLTime('30f', {frameRate: 30}), 1);
assert.equal(parseTTMLTime('100t', {tickRate: 1000}), 0.1);

console.log('ARIB border and marquee mapping: ok');
