'use client';

import React, { useCallback, useEffect, useId, useRef, useState, type ReactNode, type Ref } from 'react';
import { ChevronLeft, ChevronRight, Image as ImageIcon, Phone } from 'lucide-react';
import { isPhoneCta } from '@/lib/approvals-v2/staff-review';
import { offerRange, weekday } from './sample';
import { VideoPreview } from './VideoPreview';
import './gbp-post-preview.css';

export type GbpPostContent = {
    title: string;
    body: string;
    scheduled: string;
    postType?: string;
    offerStart?: string | null;
    offerEnd?: string | null;
    ctaLabel?: string;
};

type StaffPhoto = {
    enlargeLabel: string;
    enlargeRef: Ref<HTMLButtonElement>;
    onEnlarge: () => void;
    onPhotoLoad: (image: HTMLImageElement) => void;
    onPhotoError: (src: string) => void;
    addPhoto?: ReactNode;
};

export function useLogoFailure(logoSrc?: string) {
    const logoRef = useRef<HTMLImageElement>(null);
    const [failedLogo, setFailedLogo] = useState<string>();
    useEffect(() => {
        const image = logoRef.current;
        if (image?.complete && !image.naturalWidth) setFailedLogo(logoSrc);
    }, [logoSrc]);
    return { logoRef, failedLogo, setFailedLogo };
}

export function previewPhotos(post: { photo: string | null; photoSrcs?: (string | null)[] }) {
    return post.photoSrcs?.length ? post.photoSrcs : post.photo ? [post.photo] : [];
}

export function GbpPostPreview({ post, clientName, logoSrc, sources = [], videoSrc, videoPosterSrc, photoIndex, onPhotoChange, staff, ctaHref }: {
    post: GbpPostContent;
    clientName: string;
    logoSrc?: string;
    sources?: readonly (string | null)[];
    videoSrc?: string | null;
    videoPosterSrc?: string | null;
    photoIndex?: number;
    onPhotoChange?: (index: number) => void;
    staff?: StaffPhoto;
    ctaHref?: string | null;
}) {
    const { logoRef, failedLogo, setFailedLogo } = useLogoFailure(logoSrc);
    const planned = weekday(post.scheduled);
    const kind = post.postType || 'offer';
    const range = offerRange(post);
    const cta = post.ctaLabel ?? (staff ? '' : 'View offer');
    const ctaContent = <>{isPhoneCta(cta) && <Phone size={16} aria-hidden />}{cta}</>;

    return <article className={`gbp-post${staff ? ' gbp-post-compact' : ''}`} aria-label="Google Business Profile post preview">
        <div className="gbp-post-header">
            <span className="gbp-post-avatar">{logoSrc && failedLogo !== logoSrc
                // eslint-disable-next-line @next/next/no-img-element -- Client logos can use storage or fixture URLs.
                ? <img ref={logoRef} src={logoSrc} alt="" onError={() => setFailedLogo(logoSrc)} />
                : <span aria-hidden="true">{clientName.charAt(0).toUpperCase()}</span>}
            </span>
            <div><strong>{clientName}</strong><small><span className="gbp-post-type">{kind}</span>{planned && <> · <time dateTime={post.scheduled}>{planned}, {post.scheduled.slice(0, 4)}</time></>}</small></div>
        </div>
        <PhotoCarousel sources={sources} videoSrc={videoSrc} poster={videoPosterSrc} alt={`Photo for ${post.title}`} index={photoIndex} onChange={onPhotoChange} staff={staff} />
        <div className="gbp-post-body">
            <p className="gbp-post-type">{kind}</p>
            <h3>{post.title}</h3>
            {range && <p className="gbp-post-offer-date">{range}</p>}
            <PostCopy body={post.body ?? ''} />
            {cta && (ctaHref
                ? <a className="gbp-post-cta" href={ctaHref} target="_blank" rel="noopener noreferrer">{ctaContent}</a>
                : <span className="gbp-post-cta">{ctaContent}</span>)}
        </div>
    </article>;
}

function PostCopy({ body }: { body: string }) {
    const id = useId();
    const ref = useRef<HTMLParagraphElement>(null);
    const [expanded, setExpanded] = useState(false);
    const [overflows, setOverflows] = useState(body.length > 140);

    useEffect(() => {
        const copy = ref.current;
        if (!copy || expanded) return;
        const measure = () => {
            if (copy.clientHeight) setOverflows(copy.scrollHeight > copy.clientHeight);
        };
        measure();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(measure);
        observer.observe(copy);
        return () => observer.disconnect();
    }, [body, expanded]);

    return <>
        <p className="gbp-post-copy" id={id} ref={ref} data-expanded={expanded}>{body}</p>
        {(expanded || overflows) && <button className="gbp-post-more" type="button" aria-controls={id} aria-expanded={expanded}
            onClick={() => setExpanded(value => !value)}>{expanded ? 'Less' : 'More'}</button>}
    </>;
}

function PhotoCarousel({ sources, videoSrc, poster, alt, index, onChange, staff }: {
    sources: readonly (string | null)[];
    videoSrc?: string | null;
    poster?: string | null;
    alt: string;
    index?: number;
    onChange?: (index: number) => void;
    staff?: StaffPhoto;
}) {
    const [localIndex, setLocalIndex] = useState(0);
    const drag = useRef<{ id: number; x: number; y: number } | null>(null);
    const suppressClick = useRef(false);
    const hasVideo = videoSrc !== undefined;
    const count = sources.length + Number(hasVideo);
    const multiple = count > 1;
    const active = Math.min(index ?? localIndex, Math.max(0, count - 1));
    const videoActive = hasVideo && active === sources.length;
    const src = sources[active];
    const mediaLabel = hasVideo ? 'media' : 'photo';
    const select = (next: number) => {
        if (next === active) return;
        if (index === undefined) setLocalIndex(next);
        onChange?.(next);
    };
    const step = (delta: number) => select((active + delta + count) % count);

    return <div className="gbp-post-carousel" data-multiple={multiple}
        role={multiple ? 'group' : undefined} aria-roledescription={multiple ? 'carousel' : undefined}
        aria-label={multiple ? (hasVideo ? 'Preview media' : 'Preview photos') : undefined} tabIndex={multiple ? 0 : undefined}
        onKeyDown={multiple ? event => {
            if ((event.target as Element).closest('video') || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            step(event.key === 'ArrowRight' ? 1 : -1);
        } : undefined}>
        <div className="gbp-post-slide"
            onPointerDown={multiple ? event => {
                if (videoActive || !event.isPrimary || event.button !== 0) return;
                suppressClick.current = false;
                drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
                // Keep delivery of pointerup while preserving the photo's normal click target.
                (event.target as Element).setPointerCapture?.(event.pointerId);
            } : undefined}
            onPointerUp={multiple ? event => {
                const start = drag.current;
                if (!start || start.id !== event.pointerId) return;
                drag.current = null;
                const dx = event.clientX - start.x;
                const dy = event.clientY - start.y;
                if (Math.abs(dx) < 35 || Math.abs(dx) <= Math.abs(dy)) return;
                suppressClick.current = true;
                step(dx < 0 ? 1 : -1);
            } : undefined}
            onPointerCancel={() => { drag.current = null; }}
            onClickCapture={event => {
                if (videoActive || !suppressClick.current || event.detail === 0) return;
                event.preventDefault();
                event.stopPropagation();
                suppressClick.current = false;
            }}>
            {videoActive ? <VideoPreview key={videoSrc} src={videoSrc ?? null} poster={poster} /> : count ? <PhotoSlide key={`${active}:${src}`} src={src} alt={multiple ? `${alt} ${active + 1} of ${count}` : alt}
                openable={multiple} staff={staff} />
                : <div className="gbp-post-placeholder">
                    <ImageIcon size={20} aria-hidden />
                    <strong>Photo needed</strong>
                    {staff?.addPhoto}
                </div>}
        </div>
        {multiple && <>
            <button type="button" className="gbp-post-arrow gbp-post-prev" aria-label={`Previous ${mediaLabel}`} onClick={() => step(-1)}><ChevronLeft size={22} aria-hidden /></button>
            <button type="button" className="gbp-post-arrow gbp-post-next" aria-label={`Next ${mediaLabel}`} onClick={() => step(1)}><ChevronRight size={22} aria-hidden /></button>
            <span className="gbp-post-count" aria-live="polite" aria-atomic="true">{active + 1} / {count}</span>
            <div className="gbp-post-dots" role="group" aria-label={`Choose ${hasVideo ? 'media' : 'a photo'}`}>
                {Array.from({ length: count }, (_, position) => <button type="button" key={position} aria-label={`Show ${mediaLabel} ${position + 1} of ${count}`}
                    aria-pressed={position === active} onClick={() => select(position)}><span /></button>)}
            </div>
        </>}
    </div>;
}

function PhotoSlide({ src, alt, openable, staff }: {
    src?: string | null;
    alt: string;
    openable: boolean;
    staff?: StaffPhoto;
}) {
    const [failed, setFailed] = useState(false);
    const imageRef = useRef<HTMLImageElement>(null);
    const onPhotoLoad = staff?.onPhotoLoad;
    const onPhotoError = staff?.onPhotoError;
    const setImageRef = useCallback((image: HTMLImageElement | null) => {
        imageRef.current = image;
        if (image?.naturalWidth) onPhotoLoad?.(image);
    }, [onPhotoLoad]);
    useEffect(() => {
        const image = imageRef.current;
        if (image?.complete && !image.naturalWidth && src) {
            setFailed(true);
            onPhotoError?.(src);
        }
    }, [src, onPhotoError]);

    if (!src || failed) return <div className="gbp-post-placeholder gbp-post-unavailable">
        <ImageIcon size={20} aria-hidden />
        <strong>Photo unavailable</strong>
        {src && <a href={src} target="_blank" rel="noopener noreferrer" aria-label={`Open ${alt.toLowerCase()}`}>Open photo</a>}
    </div>;

    // eslint-disable-next-line @next/next/no-img-element -- Images may use signed or external thumbnail URLs.
    const image = <img ref={setImageRef} src={src} alt={staff ? '' : alt} referrerPolicy="no-referrer" draggable={false}
        onLoad={event => onPhotoLoad?.(event.currentTarget)} onError={() => { setFailed(true); onPhotoError?.(src); }} />;

    if (staff) return <button type="button" className="gbp-post-photo" ref={staff.enlargeRef} aria-label={staff.enlargeLabel} onClick={staff.onEnlarge}>{image}</button>;
    if (openable) return <a className="gbp-post-photo" href={src} target="_blank" rel="noopener noreferrer" draggable={false}
        aria-label={`Open ${alt.toLowerCase()}`}>{image}</a>;
    return image;
}
