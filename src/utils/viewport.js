export function getMediaContentViewport(overlay, mediaElement) {
    const overlayWidth = overlay.clientWidth || 1;
    const overlayHeight = overlay.clientHeight || 1;
    if (!mediaElement ||
        !mediaElement.videoWidth ||
        !mediaElement.videoHeight ||
        !overlay.getBoundingClientRect ||
        !mediaElement.getBoundingClientRect) {
        return { left: 0, top: 0, width: overlayWidth, height: overlayHeight };
    }

    const overlayRect = overlay.getBoundingClientRect();
    const mediaRect = mediaElement.getBoundingClientRect();
    const mediaLeft = mediaRect.left - overlayRect.left;
    const mediaTop = mediaRect.top - overlayRect.top;
    const mediaWidth = mediaRect.width || overlayWidth;
    const mediaHeight = mediaRect.height || overlayHeight;
    const videoAspect = mediaElement.videoWidth / mediaElement.videoHeight;
    const elementAspect = mediaWidth / mediaHeight;
    let contentWidth = mediaWidth;
    let contentHeight = mediaHeight;
    let contentLeft = mediaLeft;
    let contentTop = mediaTop;

    if (elementAspect > videoAspect) {
        contentWidth = mediaHeight * videoAspect;
        contentLeft += (mediaWidth - contentWidth) / 2;
    } else if (elementAspect < videoAspect) {
        contentHeight = mediaWidth / videoAspect;
        contentTop += (mediaHeight - contentHeight) / 2;
    }

    return {
        left: contentLeft,
        top: contentTop,
        width: contentWidth,
        height: contentHeight
    };
}

export function isElementNode(value) {
    return typeof Element !== 'undefined' && value instanceof Element;
}
