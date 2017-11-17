//---------------------------------------------------------------------------
//  File: ScatterLayer.js
//  Change: 杨国强，创建于2016-08-19
//
//---------------------------------------------------------------------------

function ScatterLayer(layer) {
	if (!layer.data) {
		console.error("没有指定数据来源");
		return;
	}
	var pData = layer.data;

	var drawMain = null; // 绘制主画布
	var drawPreview = null; // 绘制预览画布
	var vertexShaderStr = `
			precision mediump float;
			const float PI = 3.1415926536;
			const float RADIAN_HALF = 3.1415926536/360.0;
			const float RADIAN_REVERSE = 180.0/3.1415926536;
			
			vec2 mercatorProjectViewport(
			  vec3 lnglat,
			  vec3 mapParam, // center lat, center lon, zoom
			  vec2 viewport // viewport: [width, height]
			) {
				// k, y1 calculated in JS
				//float k = pow(2.0, mapParam.z - 3.0) * TILE_SIZE;
				//float y1 = log(tan(PI / 4.0 + centerLngLat.y * PI / 360.0));
				float y2 = log(tan(PI / 4.0 + lnglat.y * RADIAN_HALF));
        return vec2( (lnglat.x - mapParam.x) * mapParam.z / viewport[0],
            (y2 - mapParam.y) * RADIAN_REVERSE * mapParam.z / viewport[1] );
			}

			attribute vec3 scatterData;  // lat, lon, density
			uniform vec2 dataRange;
			uniform vec3 mapParam;  // center lat, center lon, zoom
			uniform vec2 viewPort;
			uniform vec3 uColor;
			uniform vec4 latlonRange;
			uniform float layerOpacity;
			uniform float animateStep;

			varying vec4 vColor;
			void main(void)
			{
		    if (latlonRange[0]<=0.0)
		    	gl_Position = vec4(mercatorProjectViewport(scatterData, mapParam, viewPort), 0.0, 1.0);
		    else
		    	gl_Position = vec4((scatterData[0]-latlonRange[0])/latlonRange[1],(scatterData[1]-latlonRange[2])/latlonRange[3], 0.0, 1.0);
		    float pSize;
		    if (latlonRange[0]<=0.0) {
			    pSize = mapParam[2]/750.0; 
			    //if (pSize>16.0) pSize = 16.0;
		    	vColor.xyz = uColor+(vec3(1.0,1.0,1.0)-uColor)*(scatterData[2]-dataRange[0])/(dataRange[1]-dataRange[0])*5.0*animateStep;
			    vColor.w = layerOpacity*(animateStep+0.2);
		    } else {
		    	vColor.xyz = uColor+(vec3(1.0,1.0,1.0)-uColor)*(scatterData[2]-dataRange[0])/(dataRange[1]-dataRange[0])*5.0;
			    vColor.w = 1.0;
			  	pSize = 0.01;
		    }
	    	gl_PointSize = pSize;
			}
	`;

	var fragmentShaderStr = `
      precision lowp float;
			varying vec4 vColor;

			void main(void)
			{
				//float dist = distance( gl_PointCoord, vec2(0.5,0.5) )*2.0;
				//if (dist>0.8) discard;
				//float alpha = 1.0; //0.8-dist;
        //gl_FragColor = vec4(vColor.xyz, alpha);
        gl_FragColor = vColor;
			}
	`;

	
	var pDataRange = [0,1000000000];
	var lonRange = GlobalVar.LonRange;
	var latRange = GlobalVar.LatRange;
	var infectedPersonBuf = [];
	var deadPersonBuf = [];
	var buf = [];
	function initCanvas() {
		let index = 0;
		let min = Number.MAX_VALUE, max = Number.MIN_VALUE;
		for (let i=0,n=pData.length;i<n&&i<2900000;i++) {
			let d = pData[i];
			if (d[2]>max) max = d[2];
			if (d[2]<min) min = d[2];
			if (d[0]<lonRange[0]) lonRange[0] = d[0];
			if (d[0]>lonRange[1]) lonRange[1] = d[0];
			if (d[1]<latRange[0]) latRange[0] = d[1];
			if (d[1]>latRange[1]) latRange[1] = d[1];
			buf[index++] = d[0];
			buf[index++] = d[1];
			buf[index++] = d[2];
		}
		pDataRange = [min,max];
		
		let previewCanvas = document.getElementById('layerPreviewCanvas');
		let mainCanvas = document.getElementById('layerMainCanvas');
		if (previewCanvas && viewerIndex==0) { // 只有第一个二维视图负责绘制缩略图
			drawPreview = initWebGL(previewCanvas, 1);
			if (drawPreview) {
				drawPreview();
		  	setLayerPreviewImg(layer.id, previewCanvas.toDataURL("image/png")); 
			}
		}
		if (mainCanvas && map) {
			drawMain = initWebGL(mainCanvas, 0);
		}
	}

	function initWebGL(canvasObject, isPreview) {
		let webgl = canvasObject.getContext("webgl");
		
    var vertexShaderObject = webgl.createShader(webgl.VERTEX_SHADER);
    var fragmentShaderObject = webgl.createShader(webgl.FRAGMENT_SHADER);

    webgl.shaderSource(vertexShaderObject, vertexShaderStr);
    webgl.shaderSource(fragmentShaderObject, fragmentShaderStr);

    webgl.compileShader(vertexShaderObject);
    webgl.compileShader(fragmentShaderObject);

    if(!webgl.getShaderParameter(vertexShaderObject, webgl.COMPILE_STATUS)){console.error(webgl.getShaderInfoLog(vertexShaderObject));return;}
    if(!webgl.getShaderParameter(fragmentShaderObject, webgl.COMPILE_STATUS)){console.error(webgl.getShaderInfoLog(fragmentShaderObject));return;}

    var programObject = webgl.createProgram();

    webgl.attachShader(programObject, vertexShaderObject);
    webgl.attachShader(programObject, fragmentShaderObject);

    webgl.linkProgram(programObject);
    if(!webgl.getProgramParameter(programObject, webgl.LINK_STATUS)){console.error(webgl.getProgramInfoLog(programObject));return;}

    webgl.useProgram(programObject);

    var attrScatterData = webgl.getAttribLocation(programObject, "scatterData");
    var attrDataRange = webgl.getUniformLocation(programObject, "dataRange");
    var attrMapParam = webgl.getUniformLocation(programObject, "mapParam");
    var attrViewPort = webgl.getUniformLocation(programObject, "viewPort");
    var attrColor = webgl.getUniformLocation(programObject, "uColor");
    var attrLatlonRange = webgl.getUniformLocation(programObject, "latlonRange");
    let attrOpacity = webgl.getUniformLocation(programObject, "layerOpacity");
    let attrAnimStep = webgl.getUniformLocation(programObject, "animateStep");
   
    var scatterBuffer = webgl.createBuffer();
	  webgl.uniform2fv(attrDataRange, pDataRange);	  
	  if (isPreview)
		  webgl.uniform4f(attrLatlonRange, lonRange[0]+(lonRange[1]-lonRange[0])/2, (lonRange[1]-lonRange[0])/2, latRange[0]+(latRange[1]-latRange[0])/2, (latRange[1]-latRange[0])/2);
		else
		  webgl.uniform4f(attrLatlonRange, -1, 0,0,0);
	  webgl.uniform3fv(attrColor, [0.0, 0.3, 0.7]);
	  webgl.uniform1f(attrOpacity, 1);
	  webgl.uniform1f(attrAnimStep, 1);
		  
		webgl.bindBuffer(webgl.ARRAY_BUFFER, scatterBuffer);
	  webgl.bufferData(webgl.ARRAY_BUFFER, new Float32Array(buf), webgl.DYNAMIC_DRAW);
    
    return function() {
		  // 绘制人口总数分布
		  webgl.useProgram(programObject);
		  if (!isPreview) {
			  let center = map.center();
			  let size = map.size();
			  let mapedlat = Math.log(Math.tan(Math.PI / 4.0 + center.lat * Math.PI / 360.0));
			  let k = Math.pow(2.0, map.zoom() - 3.0) * 512.0 / 45.0;
			  webgl.uniform3fv(attrMapParam, [center.lon, mapedlat, k]);
			  webgl.uniform2fv(attrViewPort, [size.x,size.y]);
			  webgl.uniform1f(attrOpacity, layer.opacity);
			  webgl.uniform1f(attrAnimStep, animateStep);
			} else {
			  webgl.clear(webgl.COLOR_BUFFER_BIT);
			}
			
		  webgl.bindBuffer(webgl.ARRAY_BUFFER, scatterBuffer);
		  webgl.enableVertexAttribArray(attrScatterData); 
		  webgl.vertexAttribPointer(attrScatterData, 3, webgl.FLOAT, false, 0, 0);

			//mainCtx.blendFunc( mainCtx.SRC_ALPHA, mainCtx.ONE );
		  webgl.drawArrays(webgl.POINTS, 0, buf.length/3);
			//mainCtx.blendFunc( mainCtx.SRC_ALPHA, mainCtx.ONE_MINUS_SRC_ALPHA );
		}
	}
	

	var animateStep = 1.0;
	var animateTick = 1.0;
	layer.onDraw = function() {
		animateTick = (animateTick+0.019) % 0.9;
		animateStep = 2*animateTick+0.1; //Math.abs((animateTick-1)/2)+0.5;
		if (drawMain) {
			drawMain();
		}
	}
	
	initCanvas();
}
