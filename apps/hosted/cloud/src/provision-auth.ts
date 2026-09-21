/** Explicit auth provisioning job used by Alchemy before updating the Worker. */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { provisionCloudAuth } from "./implementation/auth-provisioning.ts";

NodeRuntime.runMain(provisionCloudAuth);
