param(
  [Parameter(ValueFromRemainingArguments=$true)]
  [String[]]$Args
)

npm run mgnl "--" @Args
