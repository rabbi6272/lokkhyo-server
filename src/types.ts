import type { AuthContext } from "@/lib/auth";

export interface AppEnv {
	Variables: {
		auth: AuthContext;
	};
}

