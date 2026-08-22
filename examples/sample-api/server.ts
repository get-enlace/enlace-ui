// Local dev harness only — not part of any published package. Runs the
// sample API + the Enlace canvas in one process. Also mounts
// swagger-ui-express alongside it — Enlace has no dependency on Swagger UI
// at all (ARCHITECTURE.md §1: the only input contract is "a URL that
// returns a valid OpenAPI 3.x document"), this is here purely to
// demonstrate that Enlace can ride along an existing Swagger UI setup
// without conflict, for consumers who happen to have one already.
import swaggerUi from 'swagger-ui-express';
import { createApp, spec } from './app.js';

const PORT = 4000;
const app = createApp();

// Existing Swagger UI, unchanged — optional, see comment above.
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(spec));

app.listen(PORT, () => {
  console.log(`Sample API docs: http://localhost:${PORT}/api-docs`);
  console.log(`Enlace UI:       http://localhost:${PORT}/enlace`);
});
