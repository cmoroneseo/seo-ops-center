'use client';

import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { normalizeProjectTitle, PROJECT_TITLE_MAX_LENGTH } from '@/lib/projects/project-cards';

export function ProjectTitle({ title, onRename }: {
    title: string;
    onRename: (title: string) => Promise<void>;
}) {
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const canCommit = useRef(false);
    const restoreFocus = useRef(false);
    const errorId = useId();

    function close(fromKeyboard: boolean) {
        canCommit.current = false;
        restoreFocus.current = fromKeyboard;
        setEditing(false);
        setError('');
    }

    async function commit(value: string, fromKeyboard: boolean) {
        if (!canCommit.current) return;
        let nextTitle: string;
        try {
            nextTitle = normalizeProjectTitle(value);
        } catch (error) {
            setError((error as Error).message);
            return;
        }
        if (nextTitle === title) {
            close(fromKeyboard);
            return;
        }

        canCommit.current = false;
        setSaving(true);
        setError('');
        try {
            await onRename(nextTitle);
            close(fromKeyboard);
        } catch (error) {
            canCommit.current = true;
            setError(error instanceof Error ? error.message : 'Could not rename the project.');
        } finally {
            setSaving(false);
        }
    }

    if (editing) {
        return (
            <div className="max-w-lg space-y-1">
                <Input
                    type="text"
                    aria-label="Project name"
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? errorId : undefined}
                    defaultValue={title}
                    maxLength={PROJECT_TITLE_MAX_LENGTH}
                    className="font-semibold md:text-xl"
                    autoFocus
                    disabled={saving}
                    onChange={() => setError('')}
                    onBlur={event => void commit(event.currentTarget.value, false)}
                    onKeyDown={event => {
                        if (event.nativeEvent.isComposing) return;
                        if (event.key === 'Escape' && canCommit.current) {
                            event.preventDefault();
                            close(true);
                        }
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            void commit(event.currentTarget.value, true);
                        }
                    }}
                />
                {error && <p id={errorId} role="alert" className="text-sm text-destructive">{error}</p>}
            </div>
        );
    }

    return (
        <div className="flex flex-wrap items-center gap-x-2">
            <h2 className="min-w-0 break-words text-xl font-semibold">{title}</h2>
            <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Rename project"
                ref={button => {
                    if (button && restoreFocus.current) {
                        restoreFocus.current = false;
                        button.focus();
                    }
                }}
                onClick={() => {
                    canCommit.current = true;
                    setEditing(true);
                }}
            >
                Rename
            </Button>
        </div>
    );
}
