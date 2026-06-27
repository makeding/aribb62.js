/*
 * DOM and XML traversal helpers for ARIB-TTML documents.
 */

export function nearestTimedNode(node) {
    let current = node;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
        if (getTTMLAttr(current, 'begin') || getTTMLAttr(current, 'end')) {
            return current;
        }
        current = current.parentNode;
    }
    return null;
}

export function getXMLId(node) {
    return node.getAttribute('xml:id') || node.getAttribute('id') || getTTMLAttr(node, 'id');
}

export function nearestTTMLAttr(node, local) {
    let current = node;
    while (current && current.nodeType === Node.ELEMENT_NODE && localName(current) !== 'tt') {
        const value = current.getAttribute(local) || getTTMLAttr(current, local);
        if (value) {
            return value;
        }
        current = current.parentNode;
    }
    return '';
}

export function getTTMLAttr(node, local) {
    if (!node || !node.attributes) {
        return '';
    }
    const direct = node.getAttribute(local) || node.getAttribute('tts:' + local) || node.getAttribute('ttp:' + local);
    if (direct) {
        return direct;
    }
    for (let i = 0; i < node.attributes.length; i++) {
        const attr = node.attributes[i];
        if (attr.localName === local) {
            return attr.value;
        }
    }
    return '';
}

export function getARIBTTMLAttr(node, local) {
    if (!node || !node.attributes) {
        return '';
    }
    const direct = node.getAttribute('arib-tt:' + local);
    if (direct) {
        return direct;
    }
    for (let i = 0; i < node.attributes.length; i++) {
        const attr = node.attributes[i];
        if (attr.localName === local && /arib-ttml/.test(attr.namespaceURI || '')) {
            return attr.value;
        }
    }
    return '';
}

export function localName(node) {
    return node.localName || node.nodeName.replace(/^.*:/, '');
}

export function firstChildByLocalName(node, name) {
    const children = childElementsByLocalName(node, name);
    return children.length > 0 ? children[0] : null;
}

export function childElementsByLocalName(node, name) {
    const result = [];
    if (!node || !node.childNodes) {
        return result;
    }
    for (let i = 0; i < node.childNodes.length; i++) {
        const child = node.childNodes[i];
        if (child.nodeType === Node.ELEMENT_NODE && localName(child) === name) {
            result.push(child);
        }
    }
    return result;
}

export function descendantsByLocalName(node, name) {
    const result = [];
    if (!node) {
        return result;
    }
    const all = node.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) {
        if (localName(all[i]) === name) {
            result.push(all[i]);
        }
    }
    return result;
}

export function hasAncestorByLocalName(node, name) {
    let current = node ? node.parentNode : null;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
        if (localName(current) === name) {
            return true;
        }
        current = current.parentNode;
    }
    return false;
}
