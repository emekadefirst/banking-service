
const database = {
  port: process.env.DB_PORT ?? "5432",
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  host: process.env.DB_HOST ?? "localhost",

};


export const databaseConfigs = {
  dbUrl: `postgresql://${database.user}:${database.password}@${database.host}:${database.port}/${database.database}`,
};