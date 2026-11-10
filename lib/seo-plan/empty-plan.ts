/** Copy for a plan that has no tasks yet. Plain language, no abbreviations. */

export const EMPTY_PLAN_TITLE = 'This plan is empty';

export const EMPTY_PLAN_BODY =
    'This is the work plan for this client. It lists the search engine optimization tasks you will do, and it starts blank so you can build it for this client.';

export const EMPTY_PLAN_ADD_TASKS =
    'Type the first task in the Add task box above, then press Enter. Paste several lines to add more than one task.';

export const EMPTY_CHECKLIST_ADD = 'Choose Add item to type the first task.';

export const NO_PLAN_TITLE = 'No work plan yet';

export function noPlanBody(clientName: string): string {
    return `A work plan is the list of search engine optimization tasks for ${clientName}. It starts empty. Create it, then type the first task.`;
}

export const CREATE_PLAN_LABEL = 'Create the plan';

export const APPLY_LIBRARY_LABEL = 'Add the saved work list';

export const APPLY_LIBRARY_HELP =
    'Adds every task from the saved search engine optimization list. You can delete any task you do not need.';

export const APPLY_ONBOARDING_LABEL = 'Add the onboarding checklist';

export const APPLY_ONBOARDING_HELP =
    'Adds the starting checklist for a new client. You can delete any task you do not need.';

export const SETUP_PLAN_NOTE =
    'The work plan starts empty. After you create the client, open the plan and type the first tasks in Add task. You can also import tasks from Basecamp.';

export const SETUP_PLAN_PREVIEW = 'No tasks yet';

export const SETUP_READY_NOTE =
    'The client is in onboarding. The work plan is empty. Open the client and type the first tasks.';

export const SETUP_SCOPE_NOTE =
    'The hours and services are saved with the client. The work plan starts empty.';

export const SETUP_MONTHLY_CHOICE = 'Ongoing search engine optimization and content';

export const SETUP_CUSTOM_CHOICE = 'Hours for a defined piece of work';
