import { connect } from "@tursodatabase/serverless";

export const db = connect({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
