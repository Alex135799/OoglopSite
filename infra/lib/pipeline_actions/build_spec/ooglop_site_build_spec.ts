export default function(rootS3BucketName : string) {
  return {
    version: '0.2',
    phases: {
      install: {
        "runtime-versions": {
          "nodejs": 22
        },
        commands: [
          "echo Installing...",
          "node --version",
          "npm --version",
          "npm ci"
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
          `aws s3 sync --delete ./dist s3://${rootS3BucketName}`
        ]
      }
    }
  }
}
