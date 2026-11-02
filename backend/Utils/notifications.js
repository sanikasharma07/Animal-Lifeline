import { Notification } from "../Models/notificationmodel.js";

// Create one in-app notification. This helper NEVER throws: a notification
// is secondary to the action that triggered it, so a notification failure
// must not fail a donation, a status change, an approval, or any other
// primary operation. Callers create notifications only AFTER the primary
// operation has succeeded, and only when something actually changed
// (new donor recorded, status actually moved, etc.), which is what
// prevents duplicates from retries and repeated webhooks.
export const notifyUser = async (recipient, { type, title, message, relatedType, relatedId }) => {
    if (!recipient) return null;
    try {
        return await Notification.create({
            recipient,
            type,
            title,
            message,
            ...(relatedType ? { relatedType } : {}),
            ...(relatedId ? { relatedId } : {}),
        });
    } catch (err) {
        // Deliberately swallowed: see the note above.
        return null;
    }
};

// Notify several users at once, de-duplicated by recipient id.
export const notifyUsers = async (recipients, payload) => {
    const uniqueIds = [...new Set((recipients || []).filter(Boolean).map((id) => String(id)))];
    if (uniqueIds.length === 0) return [];
    try {
        return await Notification.insertMany(uniqueIds.map((recipient) => ({
            recipient,
            ...payload,
        })));
    } catch (err) {
        return [];
    }
};
