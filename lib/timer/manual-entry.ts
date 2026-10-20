import { defaultSendToBasecamp } from '../basecamp/send-default.ts';

/**
 * A manual time entry starts from the database defaults:
 * billable and counts_toward_budget are both true. SEO hours still require a
 * client, and Basecamp is offered only when that client can receive it.
 */
export interface ManualTimeChoices {
    billable: boolean;
    countsTowardBudget: boolean;
    sendOverride?: boolean;
}

export function manualTimeDefaults(): ManualTimeChoices {
    return { billable: true, countsTowardBudget: true };
}

export function manualTimeWrite(
    choices: ManualTimeChoices,
    options: { clientId?: string | null; basecampEligible: boolean },
): { billable: boolean; countsTowardBudget: boolean; syncToBasecamp: boolean } {
    return {
        billable: choices.billable,
        countsTowardBudget: Boolean(options.clientId) && choices.countsTowardBudget,
        syncToBasecamp: defaultSendToBasecamp(options.basecampEligible, choices.sendOverride),
    };
}

export function basecampSendHint(options: {
    clientId?: string | null;
    checking: boolean;
    eligible: boolean;
}): string {
    if (!options.clientId) return 'Select a client before sending time to Basecamp.';
    if (options.checking) return 'Checking whether this client sends time to Basecamp.';
    if (options.eligible) return "Adds this time to the client's project timesheet.";
    return 'This client is not set up to send time to Basecamp.';
}
