<!DOCTYPE html>
<html xml:lang="${cmsfn.language()}" lang="${cmsfn.language()}">
  <head>
    [@cms.page /]
    <title>${content.windowTitle!content.title!}</title>
    <link rel="stylesheet" type="text/css" href="${ctx.contextPath}/.resources/tbscg/webresources/css/hellow-style.css" media="all" />
  </head>
  <body>

    <div class="container">
      <h1>${content.windowTitle!content.title!} works!</h1>
    </div>

  </body>
</html>