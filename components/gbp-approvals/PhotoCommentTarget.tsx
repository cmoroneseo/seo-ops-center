'use client';

import React, { useState } from 'react';

export function usePhotoCommentTarget(sources: readonly (string | null)[], startOnPhoto = false) {
    const [photoIndex, setPhotoIndex] = useState(0);
    const [photoPosition, setPhotoPosition] = useState<number | null>(startOnPhoto && sources[0] ? 1 : null);

    function selectSlide(index: number) {
        setPhotoIndex(index);
        setPhotoPosition(sources[index] ? index + 1 : null);
    }

    function selectTarget(position: number | null) {
        if (position === null) setPhotoPosition(null);
        else selectSlide(position - 1);
    }

    return { photoIndex, photoPosition, selectSlide, selectTarget };
}

export function PhotoCommentTarget({ sources, value, onChange, className, fieldClassName }: {
    sources: readonly (string | null)[];
    value: number | null;
    onChange: (position: number | null) => void;
    className: string;
    fieldClassName: string;
}) {
    return <label className={className}>
        Comment on
        <select className={fieldClassName} value={value ?? ''} onChange={event => onChange(Number(event.target.value) || null)}>
            <option value="">Whole post</option>
            {sources.map((src, index) => <option key={index} value={index + 1} disabled={!src}>Photo {index + 1}</option>)}
        </select>
    </label>;
}
