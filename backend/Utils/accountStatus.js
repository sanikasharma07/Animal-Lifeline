import { ApiError } from "./ApiError.js";
import { User } from "../Models/usermodel.js";

// Account suspension, shared by login, refresh and the auth middleware
// so all three enforce it the same way. A temporary suspension expires
// on its own: the first authenticated check after suspendedUntil has
// passed lifts it in the database and lets the request through, so no
// cron job or background worker is needed. An indefinite suspension has
// no suspendedUntil and stays until an admin lifts it.
export const liftExpiredSuspension = async (user) => {
    if (user.accountStatus !== "Suspended") return user;
    if (user.suspendedUntil && new Date() > new Date(user.suspendedUntil)) {
        return await User.findByIdAndUpdate(user._id, {
            accountStatus: "Active",
            suspendedUntil: null,
            suspensionReason: null,
        }, { new: true });
    }
    return user;
};

export const assertNotSuspended = async (user) => {
    const current = await liftExpiredSuspension(user);
    if (current.accountStatus === "Suspended") {
        const until = current.suspendedUntil
            ? ` until ${new Date(current.suspendedUntil).toISOString()}`
            : " indefinitely";
        throw new ApiError(403, `Your account is suspended${until}.${current.suspensionReason ? ` Reason: ${current.suspensionReason}` : ""}`);
    }
    return current;
};
