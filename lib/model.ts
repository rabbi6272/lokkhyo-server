import mongoose, { type Schema } from "mongoose";

/**
 * Register a Mongoose model, replacing any previous registration of the name.
 *
 * Next.js dev hot reload re-evaluates model modules in a process where the
 * model already exists, and `mongoose.model()` throws `OverwriteModelError` on
 * a second registration. Reusing the cached model would avoid the throw but
 * keep the *old* schema, so an edited field would silently not exist until a
 * restart. Deleting and re-registering keeps the schema current. In
 * production each module evaluates once, so this is a plain `model()` call.
 */
export function defineModel<TSchema extends Schema>(name: string, schema: TSchema) {
	if (mongoose.models[name]) {
		mongoose.deleteModel(name);
	}
	return mongoose.model(name, schema);
}
