import { ArrayMinSize, IsArray, IsNotEmpty, IsString } from 'class-validator';

export class CreateAssemblyJobsDto {
  // Unit references, each a cuid id or an engineNumber.
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  unitRefs!: string[];
}
