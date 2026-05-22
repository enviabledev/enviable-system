import { CustomDecorator, SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY } from './metadata-keys';

/** Mark a route as not requiring authentication. The global AuthGuard skips it. */
export const Public = (): CustomDecorator => SetMetadata(IS_PUBLIC_KEY, true);
