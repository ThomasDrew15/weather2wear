import { CosmosClient, type Container } from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";

// Database name matches infra/modules/data/main.tf's azurerm_cosmosdb_sql_database.this.name.
const DATABASE_NAME = "woa";
const USERS_CONTAINER_NAME = "users";

let cachedContainer: Container | undefined;

export function getUsersContainer(): Container {
  if (cachedContainer) return cachedContainer;
  const endpoint = process.env.COSMOS_ACCOUNT_ENDPOINT;
  if (!endpoint) throw new Error("COSMOS_ACCOUNT_ENDPOINT is not set");

  // AAD/RBAC data-plane access only — the Cosmos account has
  // local_authentication_enabled = false, so there is no master key to fall
  // back to even if one were passed here.
  const client = new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });
  cachedContainer = client.database(DATABASE_NAME).container(USERS_CONTAINER_NAME);
  return cachedContainer;
}
