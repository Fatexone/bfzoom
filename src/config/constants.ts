export const ADMIN_EMAIL = "brice.faradji@gmail.com";

const parseBooleanFlag = (value: string | undefined, defaultValue: boolean) => {
	const normalized = (value || "").trim().toLowerCase();
	if (!normalized) return defaultValue;
	if (["1", "true", "yes", "on"].includes(normalized)) return true;
	if (["0", "false", "no", "off"].includes(normalized)) return false;
	return defaultValue;
};

export const ENABLE_STANDALONE_CHAT_MODULE = parseBooleanFlag(
	process.env.NEXT_PUBLIC_ENABLE_STANDALONE_CHAT_MODULE,
	true
);