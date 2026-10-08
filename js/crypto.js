const PBKDF2_ITERATIONS = 600000;
export const SALT_LENGTH = 16;
const IV_LENGTH = 12;

async function getPasswordKey(password) {
    const enc = new TextEncoder();
    return await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveKey"]);
}

async function deriveKey(passwordKey, salt) {
    return await crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
        passwordKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

export async function encryptAndPackData(plainTextContent, password) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const pwdKey = await getPasswordKey(password);
    const aesKey = await deriveKey(pwdKey, salt);

    const enc = new TextEncoder();
    const plainText = enc.encode(plainTextContent);

    const cipherBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, aesKey, plainText);
    const cipherArray = new Uint8Array(cipherBuffer);
    const packed = new Uint8Array(SALT_LENGTH + IV_LENGTH + cipherArray.length);
    packed.set(salt, 0);
    packed.set(iv, SALT_LENGTH);
    packed.set(cipherArray, SALT_LENGTH + IV_LENGTH);

    return packed;
}

export async function unpackAndDecryptData(packedBuffer, password) {
    const packedArray = new Uint8Array(packedBuffer);
    if (packedArray.length < SALT_LENGTH + IV_LENGTH) throw new Error("ファイル形式が正しくないか、破損しています。");

    const salt = packedArray.slice(0, SALT_LENGTH);
    const iv = packedArray.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const cipherArray = packedArray.slice(SALT_LENGTH + IV_LENGTH);

    const pwdKey = await getPasswordKey(password);
    const aesKey = await deriveKey(pwdKey, salt);

    try {
        const decryptedBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, aesKey, cipherArray);
        const dec = new TextDecoder();
        return { text: dec.decode(decryptedBuffer) };
    } catch (e) {
        throw new Error("パスワードが違うか、ファイルが破損しています。");
    }
}
