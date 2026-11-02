import { Router } from "express";
import { getMyNotifications, getUnreadCount, markNotificationRead, markAllNotificationsRead } from "../Controllers/notificationcontroller.js";
import { verifyJWT } from "../middlewares/authmiddleware.js";

const notificationRouter = Router();
notificationRouter.use(verifyJWT);

// "/unread-count" and "/read-all" must come before "/:id/read" in
// registration order only for readability; they are distinct paths, so
// Express matches them exactly regardless.
notificationRouter.route("/").get(getMyNotifications);
notificationRouter.route("/unread-count").get(getUnreadCount);
notificationRouter.route("/read-all").patch(markAllNotificationsRead);
notificationRouter.route("/:id/read").patch(markNotificationRead);
export default notificationRouter;
