import {Router} from "express";
import { registerUser , loginuser, logoutUser } from "../Controllers/usercontroller.js";
import { verifyJWT } from "../middlewares/authmiddleware.js";


const userRouter = Router();
userRouter.route("/register").post(registerUser);
userRouter.route("/login").post(loginuser);
userRouter.route("/logout").post(verifyJWT , logoutUser);
userRouter.route("/impact-profile").get(verifyJWT, getUserImpactProfile);

export default userRouter;
