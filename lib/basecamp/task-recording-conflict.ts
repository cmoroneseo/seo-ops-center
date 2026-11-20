const RECORDING_UNIQUE_INDEX = 'tasks_basecamp_recording_unique';

export function isBasecampRecordingConflict(error: unknown): boolean {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== '23505') return false;
    return ('constraint' in error && error.constraint === RECORDING_UNIQUE_INDEX)
        || ('message' in error && typeof error.message === 'string'
            && error.message.includes(`"${RECORDING_UNIQUE_INDEX}"`));
}
