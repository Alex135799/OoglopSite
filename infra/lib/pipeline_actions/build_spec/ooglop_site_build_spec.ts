export default function(rootS3BucketName : string) {
  return {
    version: '0.2',
    phases: {
      install: {
        commands: [
          "echo Installing...",
          "npm install"
        ]
      },
      pre_build: {
        commands: [
          "echo pre-build...",
          "npm test"
        ]
      },
      build: {
        commands: [
          "echo Build started on `date`",
          "echo Compiling the Node.js code",
          "npm run build"
        ]
      },
      post_build: {
        commands: [
          "echo Build completed on `date`",
          `aws s3 sync --delete ./build s3://${rootS3BucketName}`
        ]
      }
    }
  }
}