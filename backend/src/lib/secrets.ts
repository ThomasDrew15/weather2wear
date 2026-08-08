import { SecretClient } from "@azure/keyvault-secrets";
import { DefaultAzureCredential } from "@azure/identity";

// Local dev: DefaultAzureCredential falls back to the az CLI session
// (az login), never a real credential in a file — same convention as every
// other secret access in this project. AZURE_CLIENT_ID (set as a
// backend-compute app setting) pins DefaultAzureCredential to the intended
// user-assigned identity in Azure; it's simply unset locally.
let cachedClient: SecretClient | undefined;

function getClient(): SecretClient {
  if (cachedClient) return cachedClient;
  const vaultUri = process.env.KEY_VAULT_URI;
  if (!vaultUri) throw new Error("KEY_VAULT_URI is not set");
  cachedClient = new SecretClient(vaultUri, new DefaultAzureCredential());
  return cachedClient;
}

let cachedMetOfficeApiKey: string | undefined;

export async function getMetOfficeApiKey(): Promise<string> {
  if (cachedMetOfficeApiKey) return cachedMetOfficeApiKey;
  const secret = await getClient().getSecret("met-office-api-key");
  if (!secret.value) throw new Error('Key Vault secret "met-office-api-key" has no value');
  cachedMetOfficeApiKey = secret.value;
  return cachedMetOfficeApiKey;
}
