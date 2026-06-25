import { IsNotEmpty, IsString } from 'class-validator';

export class UpgradeAssemblyJobDto {
  // The unit to upgrade SKD -> CBU, as a cuid id or an engineNumber. Single
  // unit per upgrade (unlike the bulk CKD start) because each upgrade is an
  // individually authorised storefront build.
  @IsString()
  @IsNotEmpty()
  unitRef!: string;
}
