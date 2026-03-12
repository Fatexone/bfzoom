export const ADMIN_EMAIL = "brice.faradji@gmail.com";

const parseBooleanFlag = (value?: string) => {
	const normalized = (value || "").trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
};

export const ENABLE_STANDALONE_CHAT_MODULE = parseBooleanFlag(
	process.env.NEXT_PUBLIC_ENABLE_STANDALONE_CHAT_MODULE
);