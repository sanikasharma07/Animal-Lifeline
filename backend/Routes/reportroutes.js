import { Router } from "express";
import { createReport, getMyReports, getReportById } from "../Controllers/reportcontroller.js";
import { verifyJWT } from "../middlewares/authmiddleware.js";

const reportRouter = Router();
reportRouter.use(verifyJWT);

// "/my" must come before "/:id", otherwise "my" would be an id.
reportRouter.route("/").post(createReport);
reportRouter.route("/my").get(getMyReports);
reportRouter.route("/:id").get(getReportById);
export default reportRouter;
