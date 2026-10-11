import {S3Client,PutObjectCommand,GetObjectCommand,CopyObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
export class S3PrivateObjectStore{
 constructor({client,quarantineBucket,cleanBucket}={}){
  if(!quarantineBucket||!cleanBucket||quarantineBucket===cleanBucket)throw new Error('Separate private quarantine and clean buckets are mandatory');
  this.client=client||new S3Client({});this.quarantineBucket=quarantineBucket;this.cleanBucket=cleanBucket;
 }
 async presignUpload({storageKey,sha256,sizeBytes,mediaType,expiresSeconds}){
  const checksum=Buffer.from(sha256,'hex').toString('base64');
  const url=await getSignedUrl(this.client,new PutObjectCommand({Bucket:this.quarantineBucket,Key:storageKey,ContentLength:sizeBytes,ContentType:mediaType,ChecksumSHA256:checksum,ServerSideEncryption:'AES256'}),{expiresIn:expiresSeconds});
  return {url,requiredHeaders:{'content-type':mediaType,'x-amz-checksum-sha256':checksum,'x-amz-server-side-encryption':'AES256'}};
 }
 async readQuarantine(storageKey){const result=await this.client.send(new GetObjectCommand({Bucket:this.quarantineBucket,Key:storageKey}));if(!result.Body)throw new Error('Uploaded blob missing');return result.Body;}
 async promoteClean(storageKey,mediaType){await this.client.send(new CopyObjectCommand({Bucket:this.cleanBucket,Key:storageKey,CopySource:encodeURIComponent(this.quarantineBucket+'/'+storageKey),ContentType:mediaType,MetadataDirective:'REPLACE',ServerSideEncryption:'AES256'}));}
 async presignDownload({storageKey,expiresSeconds}){return getSignedUrl(this.client,new GetObjectCommand({Bucket:this.cleanBucket,Key:storageKey}),{expiresIn:expiresSeconds});}
 async deleteQuarantine(storageKey){await this.client.send(new DeleteObjectCommand({Bucket:this.quarantineBucket,Key:storageKey}));}
 async deleteClean(storageKey){await this.client.send(new DeleteObjectCommand({Bucket:this.cleanBucket,Key:storageKey}));}
}
